# syntax=docker/dockerfile:1
FROM node:20-alpine AS base
WORKDIR /repo
RUN corepack enable

FROM base AS deps
COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/shared-types/package.json packages/shared-types/package.json
RUN pnpm install --frozen-lockfile --filter @cts-dc-opsdesk/api...

FROM deps AS build
COPY apps/api apps/api
COPY packages/shared-types packages/shared-types
# pnpm skips workspace packages' build/prepare scripts by default (see
# apps/web/package.json's own shared-types usage note) — apps/api imports
# its types (`import type`, erased at emit, but tsc still needs dist/
# index.d.ts to resolve the module at compile time), so this must be built
# explicitly before the app itself.
RUN pnpm --filter @cts-dc-opsdesk/shared-types build
RUN pnpm --filter @cts-dc-opsdesk/api prisma:generate
RUN pnpm --filter @cts-dc-opsdesk/api build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /repo/apps/api/dist ./dist
COPY --from=build /repo/apps/api/node_modules ./node_modules
COPY --from=build /repo/apps/api/prisma ./prisma
EXPOSE 3000
CMD ["node", "dist/main.js"]
