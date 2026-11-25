# Zabbix integration (live views inside OpsDesk)

OpsDesk reads hosts, problems, latest values and graphs from Zabbix **live**
through the Zabbix JSON-RPC API. Nothing Zabbix returns is stored in Postgres
(spec §3.2, ADR-003). The only write is acknowledging a problem, which is
audited in OpsDesk and noted in Zabbix with the OpsDesk user's email.

Code: `apps/api/src/modules/monitoring/zabbix/`, web pages `/zabbix`,
`/zabbix/hosts/:hostId` and `/zabbix/settings`.

## One-time setup

1. **Server key.** Set `INTEGRATION_SECRETS_KEY` in `apps/api/.env` (32 random
   bytes, base64 — see `.env.example`). It encrypts the Zabbix token in the
   database. Changing it makes the saved token unreadable; re-enter it.
2. **Migrate and seed.** `pnpm prisma:migrate` (or `prisma migrate deploy`),
   then `pnpm --filter @cts-dc-opsdesk/api prisma:seed`. The seed creates the
   connection with `ZABBIX_API_URL` (default
   `http://127.0.0.1/zabbix/api_jsonrpc.php`) and no token.
3. **Zabbix API token.** In Zabbix: Users → API tokens → Create. Use a user
   that can read the host groups OpsDesk should show and acknowledge problems.
4. **Save it in OpsDesk.** As a Super Admin or Delivery/Ops Manager open
   Monitoring → Zabbix settings, paste the token, Save, then
   **Test connection**. Every row should be PASS.

## Tag your Zabbix hosts

| Tag    | Example              | Effect                                                 |
| ------ | -------------------- | ------------------------------------------------------ |
| `site` | `SITE01`             | Site-scoped users see the host only if it's their site |
| `ci`   | `SITE01-R01-SRV-001` | Links the host to its CMDB record                      |

Untagged hosts are visible only to all-site roles (Super Admin, Delivery/Ops
Manager, Auditor). The same tags drive the existing Zabbix alert webhook.

## Who can do what

| Action                          | Roles                                                             |
| ------------------------------- | ----------------------------------------------------------------- |
| Edit URL / token / on-off, test | Super Admin, Delivery/Ops Manager                                 |
| See hosts, problems, graphs     | All internal roles, limited to their sites (no client viewers)    |
| Acknowledge / add a note        | Super Admin, Delivery/Ops Manager, NOC, Site Engineer, Infra Lead |

## Troubleshooting

| Message                             | Cause / fix                                                             |
| ----------------------------------- | ----------------------------------------------------------------------- |
| `ZABBIX_NOT_CONFIGURED`             | No token saved — step 4                                                 |
| `ZABBIX_DISABLED`                   | Switched off on the settings page                                       |
| `SECRETS_KEY_MISSING`               | `INTEGRATION_SECRETS_KEY` not set — step 1, restart the API             |
| `ZABBIX_TOKEN_UNREADABLE`           | Key changed since the token was saved — re-enter the token              |
| `ZABBIX_NETWORK` / `ZABBIX_TIMEOUT` | Zabbix down or URL wrong; Zabbix in WSL needs `networkingMode=mirrored` |
| `ZABBIX_API` "Not authorised"       | Token expired, revoked, or its user lacks permission                    |

Graphs use raw history up to 3 days and Zabbix's hourly trends beyond that
(max 31 days per request).

## Rollback

`DROP TABLE "zabbix_connections";` (see the migration header) and remove the
`zabbix/` folder from the monitoring module. No other table is affected.
