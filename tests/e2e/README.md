# End-to-end tests

Full operating chain per spec §21 / §21.1: create incident -> assign ->
acknowledge -> worklog -> vendor -> resolve -> close. The first target here
is the "Recommended First Development Demo" vertical slice (spec §31).

## Running

The first HTTP e2e harness lives in **`apps/api/test/`** and boots the real
`AppModule` over a socket with supertest against a real Postgres:

```bash
pnpm --filter @cts-dc-opsdesk/api test:e2e
```

It reuses the dev database from `apps/api/.env` but redirects every query to an
isolated **`e2e` schema** (via `test/env.js`), so a run never touches `public`.
One-time setup of that schema:

```bash
cd apps/api
DATABASE_URL="postgresql://opsdesk:opsdesk@localhost:5432/opsdesk?schema=e2e" \
  npx prisma migrate deploy
```

Override the target with `E2E_SCHEMA=<name>` or `E2E_DATABASE_URL=<url>`.
Each spec `TRUNCATE`s the schema and re-seeds a minimal fixture
(`test/fixture.ts`: four role-holders, a site, a CI) in `beforeAll`.

- `test/dev-b-authz.e2e-spec.ts` — Dev B request path: guards reject (401/403),
  reads are open, `dev-login` mints a usable token, the global `ValidationPipe`
  rejects at the edge (unknown field, oversized batch), and module happy paths
  (problem numbering, idempotent alert ingest).
