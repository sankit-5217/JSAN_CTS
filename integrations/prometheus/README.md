# Prometheus monitoring adapter

Owner: Dev B (Integrations, Hardware & Governance). Package: `@cts-dc-opsdesk/prometheus-adapter`.

Normalizes Prometheus **Alertmanager** webhook deliveries into the
`NormalizedAlertPayload` contract (`packages/shared-types/src/alert.ts`) for
`POST /api/v1/alerts/ingest`. Same normalized contract as the Zabbix adapter.
**No custom time-series store here — Prometheus stays the source of truth for
metrics** (spec §3.2). Build order: Sprint 9.

## What this package does

- `normalizeAlertmanagerAlert(alert, index?)` — one alert → one
  `NormalizedAlertPayload`. Throws `AlertNormalizationError` (with `.field`,
  `.index`) on missing labels or an unparseable `startsAt`.
- `normalizeAlertmanagerWebhook(payload)` — a full delivery →
  `{ normalized, errors }`. Per-alert failures are collected, not fatal; only a
  broken envelope throws.
- `eventId` is `prom-<fingerprint>-<startsAt epoch>` so each firing episode is a
  distinct alert row and its `resolved` delivery correlates back to it.
- Severity from the `severity` label (`critical`/`warning`/`info`/…), default
  `WARNING`. `status: "resolved"` → `RECOVERED` (timestamped from `endsAt`).

## Alertmanager route contract

Every alert routed to OpsDesk **must** carry `site` and `ci` labels — add them
via recording-rule labels, `external_labels`, or Alertmanager relabeling.
`component` / `device` / `instance` are used, in that order, for the component
key.

## Not in this package

The Alertmanager receiver endpoint and the forward to `/alerts/ingest` live in
`apps/worker`. Maintenance-window suppression is handled server-side in the
`alerts` module.
