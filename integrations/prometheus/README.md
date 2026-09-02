# Prometheus monitoring adapter

Owner: Dev B (Integrations, Hardware & Governance).

Alternative/complementary monitoring source to Zabbix, same normalized
alert contract. Do not build a custom time-series store here — Prometheus
remains the source of truth for metrics (spec §3.2).
