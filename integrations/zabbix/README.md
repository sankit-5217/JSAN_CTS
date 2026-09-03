# Zabbix monitoring adapter

Owner: Dev B (Integrations, Hardware & Governance). Package: `@cts-dc-opsdesk/zabbix-adapter`.

Normalizes Zabbix webhook events into the `NormalizedAlertPayload` contract
(`packages/shared-types/src/alert.ts`) so the worker can forward them to
`POST /api/v1/alerts/ingest`. Pure functions only — **no raw Zabbix metrics are
persisted; they stay in Zabbix** (spec §3.2, §10.11). Build order: Sprint 9.

## What this package does

`normalizeZabbixEvent(event: ZabbixWebhookEvent): NormalizedAlertPayload`

- Deterministic, no I/O. Throws `AlertNormalizationError` (with `.field`) when a
  required field is missing or malformed.
- `eventId` is prefixed `zbx-` and reuses `{EVENT.ID}`, so a problem and its
  later recovery land on the same alert row (dedup happens server-side).
- Severity comes from `{EVENT.NSEVERITY}` (0..5), falling back to the textual
  `{EVENT.SEVERITY}`, then `WARNING`.
- State: `{EVENT.VALUE}` `0` → `RECOVERED`; acknowledged/updated → `ACKNOWLEDGED`;
  otherwise `OPEN`.

## Zabbix media type contract

Zabbix webhook bodies are defined by the media type script, so that script must
emit one JSON object per event matching `ZabbixWebhookEvent` (see `src/types.ts`).
Every exported trigger **must** carry `site` and `ci` event tags; `component` and
`alertType` tags are used when present. Without a `site` tag the adapter falls
back to a `SITE01-...` style prefix on `{HOST.HOST}` and errors if neither is
available.

## Not in this package

Polling/subscription transport and the HTTP call to `/alerts/ingest` live in
`apps/worker`. Maintenance-window suppression is a server-side concern in the
`alerts` module.
