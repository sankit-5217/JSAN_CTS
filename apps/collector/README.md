# Site collector

Owner: Dev B (Integrations, Hardware & Governance). Package: `@cts-dc-opsdesk/collector`.

Implements ADR-004 / spec §11: one lightweight process runs **at each site**,
queries approved local management endpoints (Redfish / Dell OME / HPE iLO / SNMP),
normalizes payloads with the `integrations/*` adapters, and pushes events
**outbound over HTTPS** to the central OpsDesk API. **No inbound ports** are
opened to any site's management plane; the collector never holds central user
credentials — only a scoped service-account token plus per-endpoint credentials
resolved from a local secret store by name.

## This slice

- **`config.ts`** — `loadConfig(raw)` parses + validates the per-site config
  (one site per collector); `apiBaseUrl` **must** be https; interval defaults.
- **`opsdesk-client.ts`** — `OpsDeskClient`, the only door to the platform:
  `ingestSnmpTraps()`, `ingestAlert()`, `ingestHealthSnapshots()`, `heartbeat()`;
  bearer token; idempotent posts (payloads carry stable ids); `OpsDeskApiError`
  on non-2xx. `fetchImpl` is injectable for tests.
- **`delivery-buffer.ts`** — `DeliveryBuffer`, a queue for events the API
  couldn't accept (disconnect). Dedupes by key, drops oldest when full, flushes
  oldest-first and **stops at the first failure** so ordering holds and the API
  isn't hammered while down.
- **`file-delivery-buffer.ts`** — `FileDeliveryBuffer` (same shape) persists the
  queue to `config.bufferFile` with an atomic write after every change, so
  buffered events survive a collector restart; a corrupt file is discarded, not
  fatal. Used when `bufferFile` is set, else the in-memory buffer.
- **`hw/`** — `mgmt-http.ts` (auth'd HTTP client for a BMC/appliance),
  `redfish-fetcher.ts` / `ome-fetcher.ts` (fetch the raw bundle, hand it to the
  matching `integrations/*` adapter), `credentials.ts` (`EnvCredentialResolver`
  — resolves `credentialRef` to `COLLECTOR_CRED_<REF>` env var, dev/default
  backing; a real deployment points this at a vault client instead).
- **`snmp/`** — `net-snmp-listener.ts` (UDP trap listener, v1/v2c), `pdu.ts`
  (decode → `snmp-adapter`'s `SnmpTrap` shape). Only started when
  `snmpSources` is non-empty; otherwise a `NoopTrapListener`.
- **`tls.ts`** — `buildApiDispatcher` (client cert for the outbound API
  connection when `config.tls` is set — plain TLS otherwise) and
  `buildEndpointDispatcher` (optionally insecure, LAN-management-endpoints
  only, never the API connection).
- **`index.ts`** — wires config + client + buffer + the poll / flush /
  heartbeat loops and graceful shutdown (`SIGINT`/`SIGTERM`).

## Status

Functionally complete for its ADR-004 scope: Redfish/Dell OME/HPE iLO polling,
SNMP trap ingestion, buffered+retried delivery (memory or disk-backed),
heartbeat (spec §26), and TLS/mTLS to the API are all wired end-to-end. What's
still missing is packaging/tooling around it, not collector logic itself:

- No `docker-compose.yml` service — `infra/docker/collector.Dockerfile` exists
  and follows the same multi-stage pattern as `api.Dockerfile`/
  `worker.Dockerfile`, but nothing runs it automatically yet.
- `EnvCredentialResolver` is a dev/default backing only — a real deployment
  needs a vault-backed `CredentialResolver`.
- No hardware simulator, so local testing without real Redfish/OME/iLO gear
  exercises everything except a successful health-snapshot delivery (the poll
  loop fails per-endpoint gracefully — logged, not fatal — see below).

## Config shape

```jsonc
{
  "siteCode": "SITE01",
  "apiBaseUrl": "https://opsdesk.jsan.example/api/v1", // outbound HTTPS only
  "apiToken": "<scoped service-account JWT>",
  "pollIntervalSeconds": 300,
  "heartbeatIntervalSeconds": 60,
  "bufferMaxItems": 10000,
  "bufferFile": "./.buffer/collector-buffer.json", // omit for in-memory only
  "tls": { "certFile": "...", "keyFile": "...", "caFile": "..." }, // mTLS to the API; omit for plain TLS
  "endpointTlsInsecure": false, // accept self-signed BMC/OME/iLO certs — never affects the API connection
  "endpoints": [
    {
      "ciCode": "SITE01-R01-SRV-040",
      "kind": "REDFISH",
      "address": "https://10.20.1.40",
      "credentialRef": "idrac-40", // resolved from COLLECTOR_CRED_IDRAC_40="user:pass"
    },
  ],
  "snmpTrapPort": 162,
  "snmpCommunity": "public",
  "snmpSources": [{ "address": "10.20.1.41", "ciCode": "SITE01-R01-SW-002" }], // empty = trap listener never starts
}
```

Supplied via `COLLECTOR_CONFIG` (inline JSON) or `COLLECTOR_CONFIG_FILE` (path).
Per-endpoint credentials come from `COLLECTOR_CRED_<CREDENTIALREF>` env vars
(ref upper-cased, non-alphanumerics → `_`), never from the config file itself.

## Running it locally

There's no real Redfish/OME/iLO hardware or SNMP source in local dev, so a
local run can't fully exercise a successful hardware poll — but it does
exercise everything else for real: config loading, the outbound TLS
connection to the API, auth, heartbeat delivery, and the buffer/retry path
(unreachable endpoints fail per-poll, logged as warnings, never crash the
process).

The one blocker to pointing the collector at `pnpm dev:api` is that it only
serves plain HTTP, and the collector refuses a non-`https://` `apiBaseUrl` by
design (ADR-004). `scripts/dev-tls-proxy.mjs` closes that gap for local dev
only — it is never how a real deployment terminates TLS.

```bash
# 1. API up as usual
pnpm dev:api

# 2. TLS terminator in front of it (generates a throwaway self-signed cert
#    into ./.dev-tls/ on first run)
pnpm dev:tls-proxy

# 3. Get a token (any seeded user works — see apps/web's LoginPage for the list)
curl -s -X POST http://localhost:3000/api/v1/auth/dev-login \
  -H "Content-Type: application/json" -d '{"email":"admin@example.com"}'

# 4. Copy collector.config.example.json to a local, gitignored copy and drop
#    the token from step 3 into "apiToken"
cp apps/collector/collector.config.example.json apps/collector/collector.config.local.json

# 5. Run the collector, pointed at the proxy and trusting its self-signed cert
COLLECTOR_CONFIG_FILE=apps/collector/collector.config.local.json \
NODE_EXTRA_CA_CERTS="$(pwd)/.dev-tls/cert.pem" \
  pnpm dev:collector
```

You should see a startup log line, then a heartbeat every
`heartbeatIntervalSeconds`; confirm it's landing with
`GET /api/v1/audit?entityType=collector&entityId=SITE01`. The example
config's one endpoint points at a non-existent BMC address on purpose — its
poll failures in the log are expected without real hardware behind it.
