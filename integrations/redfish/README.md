# Redfish integration adapter

Owner: Dev B (Integrations, Hardware & Governance). Package: `@cts-dc-opsdesk/redfish-adapter`.

Vendor-neutral baseline for server hardware health (spec §10.12, §12). Normalizes
a bundle of Redfish resources for one system into the `HealthSnapshotPayload`
contract (`packages/shared-types/src/health.ts`) that the `cmdb` module persists
as the CI's current `HealthSnapshot`. **This adapter never writes to core
ticket/incident tables**, and it is **read-only** against the BMC — no PATCHes,
no `Actions` (CLAUDE.md "no destructive hardware actions in v1"). Build order:
Sprint 10.

## What this package does

`normalizeRedfishSystem(bundle: RedfishSystemBundle): HealthSnapshotPayload`

- Deterministic, no I/O. Throws `RedfishNormalizationError` (with `.field`) when
  the bundle has no `ciCode` or no `system` resource.
- Maps Redfish `Health` (`OK` / `Warning` / `Critical`) to `HEALTHY` / `WARNING`
  / `CRITICAL`; anything else is `UNKNOWN`. Overall health is the worst of the
  system rollup, every degraded component, and any predictive drive failure.
- **Compact by design**: only non-healthy components appear in `degraded[]`;
  per-sensor readings are dropped (they live in the monitoring platform, not the
  CMDB). `summary` carries drive/fan/PSU counts; drives also carry
  `predictedFailure`.
- A drive with `FailurePredicted: true` becomes a `predictiveFailures[]` entry
  and lifts overall health to at least `WARNING` — this is the disk-failure path
  in the first integration demo (spec §31, step 4).
- Components with `Status.State === "Absent"` are skipped entirely.

## Input bundle

The site collector maps a BMC address to an OpsDesk CI code, then gathers
`ComputerSystem` + (optionally) `Thermal`, `Power` and the flattened `Drives`
list into a `RedfishSystemBundle` (see `src/types.ts`) and hands it here.

## Not in this package

The collector's Redfish HTTP client, session auth and polling loop; the call
that persists the snapshot (that is `cmdb`'s concern). Runs behind the site
collector over outbound TLS/mTLS — management ports never face the Internet
(spec §11). Tests use sanitized fixture payloads (spec §21).
