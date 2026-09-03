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
  `ingestSnmpTraps()`, `ingestAlert()`; bearer token; idempotent posts (payloads
  carry stable ids); `OpsDeskApiError` on non-2xx. `fetchImpl` is injectable for tests.
- **`delivery-buffer.ts`** — `DeliveryBuffer`, a queue for events the API
  couldn't accept (disconnect). Dedupes by key, drops oldest when full, flushes
  oldest-first and **stops at the first failure** so ordering holds and the API
  isn't hammered while down.
- **`file-delivery-buffer.ts`** — `FileDeliveryBuffer` (same shape) persists the
  queue to `config.bufferFile` with an atomic write after every change, so
  buffered events survive a collector restart; a corrupt file is discarded, not
  fatal. Used when `bufferFile` is set, else the in-memory buffer.
- **`index.ts`** — wires config + client + buffer + the poll / flush loops.

## Next slices

- Redfish / OME / iLO HTTP clients (read-only — no PATCH, no `Actions`) that fetch
  per `config.endpoints`, hand the bundle to the matching adapter, and
  `buffer.enqueue({ channel: "alert" | "health", ... })`.
- SNMP trap listener (UDP/162) → `snmp-adapter` → buffer.
- Health-snapshot delivery once the API exposes the ingest endpoint.
- Collector heartbeat (spec §26) once the API exposes a liveness endpoint — a
  silent collector must not read as "everything healthy".
- Disk-backed buffer; mTLS client cert.

## Config shape

```jsonc
{
  "siteCode": "SITE01",
  "apiBaseUrl": "https://opsdesk.jsan.example/api/v1",
  "apiToken": "<scoped service-account JWT>",
  "pollIntervalSeconds": 300,
  "heartbeatIntervalSeconds": 60,
  "bufferMaxItems": 10000,
  "endpoints": [
    {
      "ciCode": "SITE01-R01-SRV-040",
      "kind": "REDFISH",
      "address": "https://10.20.1.40",
      "credentialRef": "idrac-40",
    },
  ],
}
```

Supplied via `COLLECTOR_CONFIG` (inline JSON) or `COLLECTOR_CONFIG_FILE` (path).
