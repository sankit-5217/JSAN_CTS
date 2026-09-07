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

- `dev-b-authz` — guards reject (401/403), reads open, `dev-login`, the global
  `ValidationPipe` rejects at the edge (unknown field, oversized batch), problem
  numbering, idempotent alert ingest.
- `vendors` — case open, duplicate `vendorCaseNo` -> 409, RMA dispatch lifecycle,
  out-of-order transition -> 400.
- `changes` — approval gates the active-maintenance feed; double approve -> 409.
- `problems` — action items, links (dup -> 409), transition matrix + root-cause
  gate, unlink.
- `knowledge` — draft -> approve -> edit bumps version + reverts to DRAFT ->
  re-approve -> unpublish; owner cannot self-approve; past review date rejected.
- `risks-bcp` — derived score/severity, status only via `/status`, BCP covers a
  site XOR a service, readiness `UNTESTED -> READY` after a logged test.
