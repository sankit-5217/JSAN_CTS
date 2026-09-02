# ADR-003: Keep raw time-series metrics and high-volume logs outside the OpsDesk database

**Status:** Accepted

## Context
Rebuilding a metrics/log store duplicates mature tools (Zabbix, Prometheus,
Grafana, Loki, OpenSearch) and would dominate engineering effort for no
product benefit (spec §3.2).

## Decision
OpsDesk stores only normalized alerts (`Alert` model), current health
state (`HealthSnapshot`), and references/links into the monitoring or log
platform — never raw metric time series or full log bodies.

## Consequences
- Postgres stays small and fast for operational queries even at scale.
- The `alerts` module (Dev B) must design a stable normalized schema that
  works across Zabbix/Prometheus/Redfish/SNMP sources.
- Deep-dive debugging still requires jumping to the monitoring/log tool via
  the stored reference — OpsDesk is not a log viewer.
