## What

<!-- One or two sentences: what does this PR do, which module does it belong to? -->

## Sprint / spec section

<!-- e.g. Sprint 4 (Incident Core), spec §10.3 -->

## Definition of Done (CLAUDE.md §"Definition of done")

- [ ] Backend authorization (RBAC + site scope) enforced server-side, not just hidden in the UI
- [ ] Audit event emitted for every business-critical mutation
- [ ] Input validated server-side (DTOs / class-validator)
- [ ] Unit/integration tests added for new logic and edge cases
- [ ] `pnpm lint && pnpm typecheck && pnpm test` pass locally
- [ ] Migration reviewed, and I know the rollback (see "Shared files" below if `schema.prisma` changed)
- [ ] OpenAPI docs render correctly for any new/changed endpoint (`/api/docs`)
- [ ] UI has error / empty / loading states (if this PR touches `apps/web`)
- [ ] No secrets, hard-coded site IDs, or hard-coded SLA values

## Touches shared files?

<!-- schema.prisma, app.module.ts, packages/shared-types, package.json, docker-compose.yml, CI -->

- [ ] No
- [ ] Yes — the other developer was pinged before I changed this, and both are tagged as reviewers

## How to verify

<!-- exact steps / curl / screenshot for the reviewer -->
