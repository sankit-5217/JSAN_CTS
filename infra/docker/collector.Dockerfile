# syntax=docker/dockerfile:1
FROM node:20-alpine AS base
WORKDIR /repo
RUN corepack enable

# apps/collector's own workspace:* dependencies (apps/collector/package.json)
# — every one needs its package.json copied into `deps` (for install) and its
# full source copied into `build` (to actually build it). Keep this list in
# sync with that package.json; a dependency missing here fails the build step
# with "Cannot find module", not a silent skip.
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/collector/package.json apps/collector/package.json
COPY packages/shared-types/package.json packages/shared-types/package.json
COPY integrations/redfish/package.json integrations/redfish/package.json
COPY integrations/dell-ome/package.json integrations/dell-ome/package.json
COPY integrations/hpe-ilo/package.json integrations/hpe-ilo/package.json
COPY integrations/snmp/package.json integrations/snmp/package.json
# --ignore-scripts: see api.Dockerfile's identical comment — a workspace
# package's own "prepare" script can't run yet with only its package.json
# present; each one is built explicitly below once full source exists.
RUN pnpm install --frozen-lockfile --filter @cts-dc-opsdesk/collector... --ignore-scripts

FROM deps AS build
COPY apps/collector apps/collector
COPY packages/shared-types packages/shared-types
COPY integrations/redfish integrations/redfish
COPY integrations/dell-ome integrations/dell-ome
COPY integrations/hpe-ilo integrations/hpe-ilo
COPY integrations/snmp integrations/snmp
# Builds shared-types + every adapter apps/collector depends on, then
# apps/collector itself, in dependency order (pnpm's `...` filter resolves
# the workspace dependency graph automatically).
RUN pnpm --filter @cts-dc-opsdesk/collector... build

FROM base AS runtime
ENV NODE_ENV=production
# See api.Dockerfile's identical comment: patch the inherited Alpine OS
# packages and drop node:20-alpine's bundled npm/npx/corepack, which this
# image never invokes (it only ever runs `node dist/index.js`) but which
# Trivy still flags as HIGH/CRITICAL if left in the final image.
RUN apk update && apk upgrade --no-cache \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack
WORKDIR /repo/apps/collector
COPY --from=build /repo/apps/collector/dist ./dist
COPY --from=build /repo/apps/collector/node_modules ./node_modules
# node_modules above symlinks each adapter to its real location as a sibling
# under /repo (see api.Dockerfile's identical comment for why) — copy each
# one's build output to the same path so the symlink resolves at container
# runtime too, not just at build time.
COPY --from=build /repo/packages/shared-types/dist /repo/packages/shared-types/dist
COPY --from=build /repo/packages/shared-types/package.json /repo/packages/shared-types/package.json
COPY --from=build /repo/integrations/redfish/dist /repo/integrations/redfish/dist
COPY --from=build /repo/integrations/redfish/package.json /repo/integrations/redfish/package.json
COPY --from=build /repo/integrations/dell-ome/dist /repo/integrations/dell-ome/dist
COPY --from=build /repo/integrations/dell-ome/package.json /repo/integrations/dell-ome/package.json
COPY --from=build /repo/integrations/hpe-ilo/dist /repo/integrations/hpe-ilo/dist
COPY --from=build /repo/integrations/hpe-ilo/package.json /repo/integrations/hpe-ilo/package.json
COPY --from=build /repo/integrations/snmp/dist /repo/integrations/snmp/dist
COPY --from=build /repo/integrations/snmp/package.json /repo/integrations/snmp/package.json
# No inbound ports (ADR-004) — only exposed if snmpSources is configured,
# and even then it's a host-network/UDP concern for the operator to wire up,
# not something this image declares.
CMD ["node", "dist/index.js"]
