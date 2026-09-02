# syntax=docker/dockerfile:1
FROM node:20-alpine AS base
WORKDIR /repo
RUN corepack enable

FROM base AS deps
COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/worker/package.json apps/worker/package.json
RUN pnpm install --frozen-lockfile --filter @cts-dc-opsdesk/worker...

FROM deps AS build
COPY apps/worker apps/worker
RUN pnpm --filter @cts-dc-opsdesk/worker build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /repo/apps/worker/dist ./dist
COPY --from=build /repo/apps/worker/node_modules ./node_modules
CMD ["node", "dist/index.js"]
