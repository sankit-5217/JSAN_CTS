# Redfish integration adapter

Owner: Dev B (Integrations, Hardware & Governance).

Vendor-neutral baseline for server hardware management (spec §10.12, §12).
Normalizes health, power, storage, thermal and firmware data into the
`HealthSnapshot` shape consumed by the `cmdb` module — this adapter must not
write directly to core ticket/incident tables.

Build order: Sprint 10, after the alert pipeline (Sprint 8) and monitoring
adapter (Sprint 9) are in place. Runs behind the site collector — never
called directly from the public API; management ports stay off the
Internet (spec §11).

Use sanitized fixture payloads for contract tests (spec §21).
