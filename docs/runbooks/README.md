# Operational runbooks

Runbooks for the platform's own operation (spec §26). One section per
scenario; each says when to use it, exact commands, and how to verify
success — not just a description of the problem.

## Database restore

**When to use this**: Postgres data loss/corruption, a bad migration that
needs rolling back to a known-good state, or standing up a staging/UAT
instance from a production-like snapshot (spec §20, UAT/STAGING environment
rule: "production-like configuration; masked/synthetic data unless
approved" — never restore a real production dump into UAT with real
customer data un-masked).

**Prerequisites**: `pg_dump`/`pg_restore`/`createdb`/`dropdb` on `PATH`
(bundled with any Postgres client install — see `psql --version` to
confirm), and `DATABASE_URL` pointing at the _target_ server (not
necessarily the one being restored from).

**Backup** (also runnable on a schedule — spec §18: "Automated DB ...
backup with periodic restore test"):

```bash
DATABASE_URL=postgresql://opsdesk:opsdesk@localhost:5432/opsdesk?schema=public \
  ./infra/scripts/backup-db.sh ./backups
```

Produces `./backups/opsdesk-<UTC timestamp>.dump` (custom format — see
`infra/scripts/backup-db.sh` for why: compressed, and restorable
selectively, not just as a whole database).

**Restore**, into a _new_ database (never restore over a live one in place
— always stand up the restored copy, verify it, then cut over):

```bash
createdb -h <host> -U opsdesk opsdesk_restored
pg_restore -h <host> -U opsdesk -d opsdesk_restored --no-owner --no-privileges \
  ./backups/opsdesk-<timestamp>.dump
```

**Verify the restore actually worked** before trusting it — row counts on
a handful of core tables, compared against the source database:

```sql
SELECT 'sites', count(*) FROM sites
UNION ALL SELECT 'incidents', count(*) FROM incidents
UNION ALL SELECT 'configuration_items', count(*) FROM configuration_items
UNION ALL SELECT 'audit_events', count(*) FROM audit_events;
```

Run the same query against both the source and the restored database; the
numbers must match. For a production drill, also spot-check that a known
incident's full timeline (`GET /incidents/:id/events`) renders identically
against the restored copy — a row-count match alone doesn't prove
relationships (CI ↔ incident ↔ audit event) survived intact.

**Last actually executed**: 2026-09-04 (Sprint 12 hardening pass) — full
round trip against the local dev database (backup → restore into a scratch
DB → row-count compare on sites/incidents/configuration_items/audit_events,
all matched exactly → scratch DB dropped). Re-run this drill periodically
per §18, not just once.

## Object storage restore

**When to use this**: MinIO/S3 data loss/corruption, or standing up a
staging/UAT instance's attachments from a production-like snapshot — same
rule as the database restore above (masked/synthetic data unless approved).

**Prerequisites**: the MinIO client (`mc`) on `PATH`, and
`S3_ENDPOINT`/`S3_ACCESS_KEY`/`S3_SECRET_KEY`/`S3_BUCKET` in the environment
(the same variables `apps/api`'s `StorageService` already reads — see
`apps/api/.env`), pointing at the _target_ server.

**Backup** (also runnable on a schedule — spec §18: "Automated DB + object
storage backup with periodic restore test"):

```bash
./infra/scripts/backup-minio.sh ./backups
```

Produces `./backups/opsdesk-attachments-<UTC timestamp>/`, a plain
directory mirroring every object in the bucket (not a proprietary archive
format — `mc mirror` again to restore it, or just copy files out directly
if only one attachment is needed).

**Restore**, into a _new_ bucket (never restore over a live one in place —
always stand up the restored copy, verify it, then cut over):

```bash
mc alias set restore-target <endpoint> <access-key> <secret-key>
mc mb restore-target/opsdesk-attachments-restored
mc mirror ./backups/opsdesk-attachments-<timestamp> restore-target/opsdesk-attachments-restored
```

**Verify the restore actually worked** before trusting it — the object
count and content must match the source exactly, not just "some files
came back":

```bash
mc diff <source-alias>/opsdesk-attachments restore-target/opsdesk-attachments-restored
```

Clean output (no lines printed) means every object matched. `mc diff`
compares by ETag/size, not just filename, so a truncated or corrupted
restore shows up here even if the object count matches.

**Last actually executed**: 2026-09-17 — full round trip against the local
dev MinIO instance (11 objects, 4.0 MB, spanning the seeded incidents' real
attachments — images, PDFs, text files): `backup-minio.sh` → a fresh
scratch bucket → `mc mirror` restore → `mc diff` against the source (clean,
zero differences) → scratch bucket dropped. Also verified the write/read
path StorageService itself uses, independent of the backup script: uploaded
a file through `POST /incidents/:id/attachments`, confirmed the object
landed in MinIO, fetched it back through the signed URL
`GET /incidents/:id/attachments/:attachmentId/download` returns, and
compared SHA-256 hashes of the original and downloaded bytes (identical).
Re-run this drill periodically per §18, not just once.

## Redis failure

**What's actually at risk**: Redis backs three BullMQ queues in
`apps/worker` — `notifications`, `sla-timers`, and `warranty-sync`
(`apps/worker/src/queues/*.queue.ts`). None of them hold source-of-truth
business state:

- **`sla-timers`** only relays an already-complete notification job; the
  SLA escalation event itself was already written to Postgres by the API's
  `SlaEscalationScanner` before this job was ever enqueued
  ([sla-timers.queue.ts:8-15](../../apps/worker/src/queues/sla-timers.queue.ts#L8-L15)).
- **`notifications`** renders and sends the actual email. Losing a queued
  job here means a notification doesn't go out — annoying, but the
  incident/SLA/change state it was about is already durable elsewhere.
  Jobs get 5 attempts with exponential backoff before they're given up on
  ([notifications.queue.ts:29-34](../../apps/worker/src/queues/notifications.queue.ts#L29-L34)).
- **`warranty-sync`** runs on a nightly cron (`0 3 * * *` local time,
  `apps/worker/src/queues/warranty-sync.queue.ts`), not from a live event —
  a missed run self-heals at the next scheduled run, or trigger it by hand
  via `POST /vendors/warranty-sync`.

**What happens on a Redis restart**: the worker's connection is built with
`maxRetriesPerRequest: null` (`apps/worker/src/redis.ts`), so `ioredis`
keeps retrying indefinitely instead of the worker process crashing — no
manual worker restart needed once Redis is back. Jobs already durably
queued in Redis (RDB/AOF, if configured) survive a plain process restart;
jobs _in flight_ at the moment Redis goes down are picked up again by
BullMQ's stalled-job recovery once the worker reconnects. A Redis **data
loss** (not just a restart) permanently drops whatever was queued and not
yet processed — per the above, that's notification delivery, not
ticket/SLA state.

**Recovery steps**:

1. Restart Redis (`redis-server.exe --port 6379 --dir <data dir>` locally;
   the equivalent service/container restart elsewhere).
2. Confirm the worker reconnected — no restart of `apps/worker` should be
   required; check its logs for a resumed BullMQ connection rather than a
   crash loop.
3. If Redis data was lost (not just restarted), no explicit backfill step
   exists for `notifications` — accept the gap. For `warranty-sync`, either
   wait for the next `0 3 * * *` run or call `POST /vendors/warranty-sync`
   directly.

**Known gap**: this hasn't been drilled with an actual `redis-server`
kill/restart against a live queue with jobs in flight — the analysis above
is from reading the queue/connection code, not an executed test. Worth
doing before relying on it for a real incident.

## Collector reinstall

Covers `apps/collector`, the on-site agent that talks to Redfish/Dell
OME/HPE iLO/SNMP and pushes health data outbound over HTTPS (ADR-004,
spec §11). It's fully containerized — `infra/docker/collector.Dockerfile`
builds a `node:20-alpine`-based image running `node dist/index.js`, no
inbound ports.

**Reinstall / redeploy procedure**:

1. Rebuild the image: `docker build -f infra/docker/collector.Dockerfile -t opsdesk-collector .`
   (or pull the published image, once a registry/CI publish step exists —
   not yet wired).
2. Stop the old container/process for that site.
3. Start the new one with the site's config — same `apiBaseUrl`,
   `bufferFile` path (if set), TLS material, and `COLLECTOR_CRED_*`
   credential env vars as before (see `apps/collector/README.md`'s config
   surface).
4. Confirm it's alive: the collector calls `heartbeat()`
   (`OpsDeskClient.heartbeat`) periodically, stored as an append-only
   `COLLECTOR_HEARTBEAT` audit event per site (spec §26) — check that a
   fresh one lands after restart.

**What survives a reinstall**: if `config.bufferFile` was set,
`FileDeliveryBuffer` persists undelivered events (alerts the API couldn't
accept while disconnected) to disk with an atomic write after every change
(`apps/collector/src/file-delivery-buffer.ts`) — reusing the same
`bufferFile` path on the new instance recovers that queue. A corrupt
buffer file is discarded rather than blocking startup. Without
`bufferFile` set, the in-memory buffer (and anything queued in it) is
lost on any restart, reinstall or not — this is a per-site config choice,
not a code limitation.

**Known gap**: no actual reinstall/redeploy has been executed against a
running collector in this project yet (no site has one deployed outside a
developer's own machine) — the procedure above is accurate to the code
and Dockerfile, not battle-tested. There's also no image registry/CI
publish step yet, so "pull the published image" isn't real until that's
built.

## Certificate rotation

Covers TLS/mTLS between the collector and the central API (ADR-004, spec
§11/§18). The two sides are asymmetric and need separate answers:

**Collector side (client cert) — fully real, in code today**:
`apps/collector/src/tls.ts`'s `buildApiDispatcher` reads
`tls.certFile`/`tls.keyFile`/`tls.caFile` from local files via
`readFileSync` **once, at startup** — there's no hot-reload. Rotation is:

1. Issue the new client cert/key for that site.
2. Replace the files at the paths `config.tls` points to.
3. Restart the collector process — it fails loud at startup
   ([tls.ts:19-20](../../apps/collector/src/tls.ts#L19-L20)) if a
   configured file is missing/unreadable, so a bad rotation is caught
   immediately rather than silently falling back to plain TLS.

**API/server side (verifying the collector's client cert, and the API's
own server cert) — not yet built**: this codebase has no production TLS
termination at all. `scripts/dev-tls-proxy.mjs` exists only to let a local
`pnpm dev:collector` reach a local `pnpm dev:api` over HTTPS during
development, and its own doc comment says explicitly it "is never how a
real deployment gets its cert." Whatever actually terminates TLS in front
of the API in a real deployment (a load balancer, ingress, reverse proxy)
hasn't been chosen yet — that decision, and the rotation procedure that
follows from it, is a genuine open item, not something to guess at here.

## Vendor API credential rotation

Covers Dell/HPE warranty-lookup API credentials
(`apps/api/src/modules/vendors/warranty.providers.ts`) and the
collector's per-endpoint BMC credentials
(`apps/collector/src/hw/credentials.ts`) — two different mechanisms.

**Warranty API keys (Dell/HPE, on the API side)**: plain environment
variables — `DELL_WARRANTY_API_KEY`, `DELL_WARRANTY_BASE_URL`,
`HPE_WARRANTY_API_KEY`, `HPE_WARRANTY_BASE_URL`, read once at startup via
`ConfigService`
([warranty.providers.ts:18-27](../../apps/api/src/modules/vendors/warranty.providers.ts#L18-L27)).
Rotation: get the new key from the vendor portal, update the env var,
restart the API. An absent key for a vendor doesn't break anything — that
vendor's CIs are reported as `skipped` in the resync summary, never faked
(outside `WARRANTY_STUB=1`/non-production, where a deterministic stub
fills in).

**Collector BMC credentials (Redfish/OME/iLO endpoints, per site)**:
`EnvCredentialResolver` reads `COLLECTOR_CRED_<REF>` (format
`username:password`) from the collector process's own environment
([credentials.ts:17-21](../../apps/collector/src/hw/credentials.ts#L17-L21)).
Rotation: update the endpoint's password on the BMC itself, update the
matching `COLLECTOR_CRED_<REF>` env var, restart the collector.

**Known gap**: both mechanisms are plain environment variables today —
the code comments on both are explicit that this is the dev/default
backing and "a real deployment points this at a vault client instead."
No secret-manager integration exists yet, so there's no rotation-without-
restart and no audit trail of _who_ rotated a credential _when_ beyond
whatever the OS/deployment platform logs for the env var change itself.

## SSO (OIDC) setup and user linking

**When to use this**: connecting an environment to an identity provider,
onboarding a user, or fixing a user whose SSO login is refused.

**How login works**: `GET /api/v1/auth/oidc/login` → IdP (authorization
code + PKCE) → `GET /api/v1/auth/oidc/callback` verifies the ID token and
maps it to an **existing** OpsDesk user → the browser lands on the web app's
`/auth/callback` with a 60-second single-use code → `POST
/api/v1/auth/oidc/exchange` returns the normal app JWT. Nobody is
auto-created: the user (email + role + site access) must exist first.
There is no user-admin API/UI yet, so provisioning is seed data or SQL, e.g.
`INSERT INTO users (id, idp_subject, email, display_name, role, updated_at)
VALUES (gen_random_uuid(), 'pending|person@example.com',
'person@example.com', 'Person Name', 'SITE_ENGINEER', now());` (plus
`user_site_access` rows for site-scoped roles). `idp_subject` is a
placeholder until the first SSO login links the real one. Every login, refusal and first-time link writes an audit event
(`USER_SSO_LOGIN`, `USER_SSO_LOGIN_REJECTED`, `USER_IDP_LINKED`).

**Connecting an IdP** (Entra ID, Okta, Keycloak, ...). Register a
confidential web client with:

- redirect URI `https://<api-host>/api/v1/auth/oidc/callback`
- post-logout redirect URI `https://<web-host>/login`
- scopes `openid email profile`; PKCE S256

Then set on the API (see `.env.example`): `OIDC_ENABLED=true`,
`OIDC_ISSUER_URL`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` (from the secret
manager, never committed), `OIDC_REDIRECT_URI` (same host as the web app's
`VITE_API_BASE_URL`, since the login cookie is scoped to that host),
`WEB_APP_URL`, optionally `OIDC_PROVIDER_LABEL`. `dev-login` is always off
when `NODE_ENV=production`.

**Local dev**: `docker compose up -d keycloak`, set `OIDC_ENABLED=true` in
`apps/api/.env`, restart the API. The realm in
`infra/keycloak/opsdesk-realm.json` has every seeded user (password
`opsdesk-dev`) plus `not-provisioned@example.com` for testing a refused
login.

**Verify**: `GET /api/v1/auth/providers` returns `sso.enabled: true`; a
sign-in via the login page's SSO button lands on the dashboard; the audit
log shows `USER_SSO_LOGIN` for that user.

**Login refused** — the login page shows the reason (`?sso_error=`):

| Reason              | Fix                                                                     |
| ------------------- | ----------------------------------------------------------------------- |
| `not_provisioned`   | Provision the user (above) with the exact email the IdP sends.          |
| `inactive`          | Reactivate the user (`is_active`).                                      |
| `identity_mismatch` | Email is linked to another IdP account — unlink it (below) if intended. |
| `email_missing`     | IdP isn't releasing the `email` claim; add it to the client's scopes.   |
| `invalid_state`     | Cookie blocked or login took >10 min; retry.                            |
| `idp_unavailable`   | API can't reach `OIDC_ISSUER_URL` — check DNS/egress.                   |

**Unlinking a user** (IdP account recreated, IdP migrated, wrong person
linked). Users are matched by `(idp_issuer, idp_subject)` once linked,
never by email alone. Clearing the link makes the next SSO login re-link by
email. No admin UI exists yet, so this is SQL — record the reason in the
change ticket:

```sql
UPDATE users SET idp_issuer = NULL WHERE email = 'person@example.com';
```
