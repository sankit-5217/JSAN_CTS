# syntax=docker/dockerfile:1
FROM node:20-alpine AS base
WORKDIR /repo
RUN corepack enable

FROM base AS deps
COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/shared-types/package.json packages/shared-types/package.json
RUN pnpm install --frozen-lockfile --filter @cts-dc-opsdesk/web...

FROM deps AS build
COPY apps/web apps/web
COPY packages/shared-types packages/shared-types
# Same reason as api.Dockerfile: pnpm skips shared-types' build script by
# default, but apps/web's `import type` usages still need dist/index.d.ts
# to resolve at tsc's type-check stage.
RUN pnpm --filter @cts-dc-opsdesk/shared-types build
RUN pnpm --filter @cts-dc-opsdesk/web build

FROM nginx:alpine AS runtime
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 5173
