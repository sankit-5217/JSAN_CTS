# Zabbix monitoring adapter

Owner: Dev B (Integrations, Hardware & Governance).

Polls/subscribes to Zabbix and pushes normalized `NormalizedAlertPayload`
events (see `packages/shared-types/src/alert.ts`) to `POST /api/v1/alerts/ingest`.
Do not persist raw Zabbix metrics — that stays in Zabbix (spec §3.2, §10.11).
Build order: Sprint 9.
