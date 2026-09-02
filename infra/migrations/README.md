# Migrations

Prisma owns migrations for `apps/api`. Never hand-edit the production
schema (spec §13).

```bash
# create + apply a new migration in dev
pnpm --filter @cts-dc-opsdesk/api prisma:migrate

# apply pending migrations in CI/staging/prod (non-interactive)
pnpm --filter @cts-dc-opsdesk/api prisma:deploy
```

Migration files live in `apps/api/prisma/migrations/` once the first
`prisma migrate dev` runs against a live Postgres instance (not generated
by this scaffold, since it requires a running database).
