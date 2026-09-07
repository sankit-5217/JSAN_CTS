# syntax=docker/dockerfile:1
FROM node:20-alpine AS base
WORKDIR /repo
RUN corepack enable

# apps/worker's own workspace:* dependencies (apps/worker/package.json) —
# keep this list in sync with that package.json.
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/worker/package.json apps/worker/package.json
COPY integrations/email/package.json integrations/email/package.json
# --ignore-scripts: see api.Dockerfile's identical comment — a workspace
# package's own "prepare" script can't run yet with only its package.json
# present; each one is built explicitly below once full source exists.
RUN pnpm install --frozen-lockfile --filter @cts-dc-opsdesk/worker... --ignore-scripts

FROM deps AS build
COPY apps/worker apps/worker
COPY integrations/email integrations/email
# Builds email-adapter, then apps/worker itself, in dependency order.
RUN pnpm --filter @cts-dc-opsdesk/worker... build

FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /repo/apps/worker
COPY --from=build /repo/apps/worker/dist ./dist
COPY --from=build /repo/apps/worker/node_modules ./node_modules
# node_modules above symlinks @cts-dc-opsdesk/email-adapter to its real
# location as a sibling under /repo (see api.Dockerfile's identical
# comment for why) — copy its build output to the same path so the
# symlink resolves at container runtime too, not just at build time.
COPY --from=build /repo/integrations/email/dist /repo/integrations/email/dist
COPY --from=build /repo/integrations/email/package.json /repo/integrations/email/package.json
CMD ["node", "dist/index.js"]
