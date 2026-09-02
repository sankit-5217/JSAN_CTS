# ADR-005: Use Redfish as the normalized server hardware integration baseline

**Status:** Accepted

## Context

Dell (iDRAC/OME) and HPE (iLO) expose different vendor-specific schemas.
The portal needs one normalized server health model regardless of vendor.

## Decision

Redfish is the common baseline adapter (`integrations/redfish`); Dell- and
HPE-specific adapters (`integrations/dell-ome`) enrich it with
vendor-specific fields where useful (service tag, OME inventory). Output
is normalized into `HealthSnapshot`/`Warranty` before reaching core
ticket logic.

## Consequences

- New hardware vendors can be added as additional adapters without
  changing the CMDB/incident schema.
- Contract tests use sanitized fixture payloads (spec §21) rather than
  live hardware in CI.
- v1 is read/observe/record only — no firmware updates, reboots or BIOS
  changes from the portal (safety boundary, spec §10.12).
