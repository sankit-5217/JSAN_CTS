# Railway deployment

Production runs on Railway in the **JSAN Projects** workspace (sankit@jsanconsulting.com, Pro plan), project **jsan-opsdesk**, environment `production`.
Code is uploaded from a local checkout with the Railway CLI (`railway up`) —
there is no GitHub auto-deploy.

## Services

| Service         | What                          | Public URL                                    |
| --------------- | ----------------------------- | --------------------------------------------- |
| `api`           | NestJS API (`apps/api`)       | https://api-production-8f7e.up.railway.app    |
| `web`           | Built SPA (`apps/web`)        | https://web-production-84787.up.railway.app   |
| `worker`        | BullMQ worker (`apps/worker`) | — (no HTTP)                                   |
| `Postgres`      | Railway Postgres (OpsDesk)    | private network only                          |
| `Redis`         | Railway Redis                 | private network only                          |
| bucket `opsdesk-attachments` | Railway Bucket (S3-compatible), attachments | signed links only |
| `zabbix-server` | `zabbix/zabbix-server-pgsql:alpine-7.0.31` | TCP proxy `iriguchi.proxy.rlwy.net:12762` → 10051 (client proxies) |
| `zabbix-web`    | `zabbix/zabbix-web-nginx-pgsql:alpine-7.0.31` (PHP frontend, port 8080) | https://zabbix-web-production-242b.up.railway.app |
| `zabbix-agent`  | `zabbix/zabbix-agent2:alpine-7.0.31` (the "Zabbix server" host) | private network only |
| `zabbix-db`     | Railway Postgres (Zabbix only — telemetry stays out of OpsDesk's DB) | private network only |

Each app service's build/start/pre-deploy/healthcheck settings live in
`deploy/railway/<service>.json` and are applied with:

```bash
railway link        # once per checkout: pick jsan-opsdesk / production
node deploy/railway/apply-settings.mjs
```

(Railway retired per-service `railway.json` files; the script writes the same
settings through the Railway API. It also sets `RAILPACK_INSTALL_CMD` so pnpm
installs devDependencies even though `NODE_ENV=production`.)

- `api` runs `prisma migrate deploy` as its **pre-deploy** step — a failed
  migration stops the deploy and the old instance keeps serving.
- `api` is health-checked on `GET /api/v1/health` (200 only when Postgres
  answers), so a build that can't reach the database is never switched in.

## Deploying

From the repo root, on the commit you want live:

```bash
railway up --service api --detach
railway up --service worker --detach
railway up --service web --detach      # only needed when apps/web changed
railway deployment list --service api --limit 1
railway logs --service api
```

`railway up` uploads the working tree minus `.gitignore`d paths (so `.env`
files never leave the machine). Commit first so production matches a commit.

`VITE_API_BASE_URL` is baked into the web build: redeploy `web` whenever the
API's domain changes.

## Variables

Set per service (`railway variable list --service <name>`). Cross-service
values use Railway references so they follow domain/credential changes:

- **api**: `NODE_ENV=production`, `DATABASE_URL=${{Postgres.DATABASE_URL}}`,
  `REDIS_URL=${{Redis.REDIS_URL}}`, `API_PUBLIC_URL=https://${{RAILWAY_PUBLIC_DOMAIN}}`,
  `WEB_APP_URL=https://${{web.RAILWAY_PUBLIC_DOMAIN}}`, `S3_ENDPOINT`, `S3_REGION`,
  `S3_BUCKET`, `S3_FORCE_PATH_STYLE=false`, and secrets `JWT_SECRET`,
  `INTEGRATION_SECRETS_KEY`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`,
  `GOOGLE_CLIENT_ID/SECRET`, `GITHUB_CLIENT_ID/SECRET`.
- **worker**: `NODE_ENV=production`, `REDIS_URL=${{Redis.REDIS_URL}}`, Gmail
  SMTP (`SMTP_HOST/PORT/SECURE`, secrets `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`).
  Outbound SMTP works because JSAN Projects is on the Pro plan (Railway blocks
  it on Trial/Hobby).
- **zabbix-server / zabbix-web**: `DB_SERVER_HOST/PORT`, `POSTGRES_USER/PASSWORD/DB`
  as references to `zabbix-db`; zabbix-web also `ZBX_SERVER_HOST=zabbix-server.railway.internal`,
  `PHP_TZ=Asia/Kolkata`, `PORT=8080`. zabbix-agent: `ZBX_HOSTNAME=Zabbix server`,
  `ZBX_SERVER_HOST=zabbix-server.railway.internal`.
- **web**: `VITE_API_BASE_URL=https://${{api.RAILWAY_PUBLIC_DOMAIN}}/api/v1`.

`JWT_SECRET` and `INTEGRATION_SECRETS_KEY` were generated randomly at setup.
Changing `JWT_SECRET` signs everyone out; changing `INTEGRATION_SECRETS_KEY`
makes stored integration secrets (the Zabbix token) unreadable — re-enter them.

Bucket credentials: `railway bucket credentials --bucket opsdesk-attachments`.

## First deploy: reference configuration and first admin

The database starts empty (migrations only, never the demo seed). `railway ssh`
needs an SSH key registered with Railway (`railway ssh keys add`).

1. Load the reference configuration — SLA policies P1-P4, the default alert
   rule, the JSAN ServiceDesk / Infra team Assignee Groups and the issue
   pick-lists and templates (no sites, users or incidents; safe to re-run):

   ```bash
   railway ssh --service api -- "cd /app/apps/api && npx ts-node prisma/seed-config.ts"
   ```

2. The first Super Admin (saxenaankit035@gmail.com) was created directly in
   the database on 2026-10-14 (audited, correlation id
   `railway-first-deploy-bootstrap`). Send them — or anyone, later, as
   break-glass — a sign-in link:

   ```bash
   railway ssh --service api -- "cd /app/apps/api && node dist/cli/send-sign-in-link.js <email>"
   ```

   The link is printed there and emailed (Gmail SMTP on the worker).

3. Create sites in the UI; give each site a support calendar (SLA business
   hours need one).

## Social sign-in

Register these callback URLs with each provider:

- Google (Cloud Console → OAuth client → Authorized redirect URIs):
  `https://api-production-8f7e.up.railway.app/api/v1/auth/social/google/callback`
- GitHub (Developer settings → OAuth App → Authorization callback URL):
  `https://api-production-8f7e.up.railway.app/api/v1/auth/social/github/callback`

Microsoft sign-in is off (no credentials set).

## Zabbix

- The default `Admin` / `zabbix` password was changed at setup; the new one
  and the OpsDesk API token were handed to the owner out of band — keep them in
  the password manager.
- OpsDesk → Zabbix: Monitoring → Zabbix settings holds the API URL
  `https://zabbix-web-production-242b.up.railway.app/api_jsonrpc.php` and the
  token (encrypted with `INTEGRATION_SECRETS_KEY`). Test connection: all PASS.
- Zabbix → OpsDesk alerts: set up with the onboarding kit against production,
  using its own secrets folder so the local webhook token is never reused:

  ```bash
  KIT_SECRETS_DIR=secrets/railway KIT_OUT_DIR=out/railway \
  ZABBIX_URL=https://zabbix-web-production-242b.up.railway.app/api_jsonrpc.php \
  OPSDESK_API=https://api-production-8f7e.up.railway.app/api/v1 \
  WEBHOOK_URL=https://api-production-8f7e.up.railway.app/api/v1/alerts/sources/zabbix \
  node tools/onboarding-kit/setup-central.mjs
  ```

  Verified 2026-10-14: a test Warning problem reached OpsDesk as an alert in
  under a minute and the re-sync job recovered it after the trigger was deleted.
- Client sites: `onboard-site.mjs` with the same env; proxies connect out to
  `iriguchi.proxy.rlwy.net:12762` (PSK). iDRAC/iLO/SNMP stay behind the
  client's proxy or site collector — never exposed to the Internet.
