# syntax=docker/dockerfile:1
FROM node:20-alpine AS base
WORKDIR /repo
RUN corepack enable

# apps/api's own workspace:* dependencies (apps/api/package.json) — every
# one needs its package.json copied into `deps` (for install) and its full
# source copied into `build` (to actually build it). Keep this list in sync
# with that package.json; a dependency missing here fails the "Test"/build
# step of CI with "Cannot find module", not a silent skip.
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/shared-types/package.json packages/shared-types/package.json
COPY integrations/email/package.json integrations/email/package.json
COPY integrations/prometheus/package.json integrations/prometheus/package.json
COPY integrations/snmp/package.json integrations/snmp/package.json
COPY integrations/warranty/package.json integrations/warranty/package.json
COPY integrations/zabbix/package.json integrations/zabbix/package.json
# --ignore-scripts: a workspace package's own "prepare" script (e.g.
# shared-types' `tsc -p tsconfig.json`) would otherwise run right here,
# before that package's tsconfig.json/src are even copied in (only
# package.json exists at this point) — it would fail every time. Each
# package is built explicitly below in the `build` stage instead, once its
# real source is present.
RUN pnpm install --frozen-lockfile --filter @cts-dc-opsdesk/api... --ignore-scripts

FROM deps AS build
COPY apps/api apps/api
COPY packages/shared-types packages/shared-types
COPY integrations/email integrations/email
COPY integrations/prometheus integrations/prometheus
COPY integrations/snmp integrations/snmp
COPY integrations/warranty integrations/warranty
COPY integrations/zabbix integrations/zabbix
# Prisma client types must exist before `nest build` type-checks
# PrismaService/anything importing @prisma/client — generate first.
RUN pnpm --filter @cts-dc-opsdesk/api prisma:generate
# Builds shared-types + every adapter apps/api depends on, then apps/api
# itself, in dependency order, in one pass (pnpm's `...` filter resolves
# apps/api's own workspace dependencies automatically — no need to name
# each one again here the way the `deps` stage above has to for COPY).
RUN pnpm --filter @cts-dc-opsdesk/api... build

FROM base AS runtime
ENV NODE_ENV=production
# node:20-alpine ships with the Alpine OS's libssl3/libcrypto3 and a full
# bundled npm CLI (pacote, sigstore, tar, minimatch, etc) baked in — this
# image only ever runs `node dist/main.js`, never npm/npx/corepack. Patch
# the OS packages and drop the unused npm install so Trivy's HIGH/CRITICAL
# scan isn't failing the build over tooling this container never executes.
RUN apk update && apk upgrade --no-cache \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack
WORKDIR /repo/apps/api
COPY --from=build /repo/apps/api/dist ./dist
COPY --from=build /repo/apps/api/node_modules ./node_modules
COPY --from=build /repo/apps/api/prisma ./prisma
# node_modules above holds symlinks to these packages' real location as
# siblings under /repo (pnpm's normal workspace layout, e.g.
# node_modules/@cts-dc-opsdesk/warranty-adapter -> ../../../integrations/
# warranty) — copying only apps/api's own output leaves those symlinks
# dangling. Copy each target's build output (not full source) to the same
# path the symlinks already point at, so requiring them actually works at
# container runtime, not just at `docker build` time.
COPY --from=build /repo/packages/shared-types/dist /repo/packages/shared-types/dist
COPY --from=build /repo/packages/shared-types/package.json /repo/packages/shared-types/package.json
COPY --from=build /repo/integrations/email/dist /repo/integrations/email/dist
COPY --from=build /repo/integrations/email/package.json /repo/integrations/email/package.json
COPY --from=build /repo/integrations/prometheus/dist /repo/integrations/prometheus/dist
COPY --from=build /repo/integrations/prometheus/package.json /repo/integrations/prometheus/package.json
COPY --from=build /repo/integrations/snmp/dist /repo/integrations/snmp/dist
COPY --from=build /repo/integrations/snmp/package.json /repo/integrations/snmp/package.json
COPY --from=build /repo/integrations/warranty/dist /repo/integrations/warranty/dist
COPY --from=build /repo/integrations/warranty/package.json /repo/integrations/warranty/package.json
COPY --from=build /repo/integrations/zabbix/dist /repo/integrations/zabbix/dist
COPY --from=build /repo/integrations/zabbix/package.json /repo/integrations/zabbix/package.json
EXPOSE 3000
CMD ["node", "dist/main.js"]
