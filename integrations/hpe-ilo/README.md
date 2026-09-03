# HPE iLO integration adapter

Owner: Dev B (Integrations, Hardware & Governance). Package: `@cts-dc-opsdesk/hpe-ilo-adapter`.

HPE-specific enrichment on the Redfish baseline (spec §10.12, §12). HPE iLO 5/6
speaks standard DMTF Redfish, so this package **composes**
`@cts-dc-opsdesk/redfish-adapter` for the common fields and layers on the HPE OEM
signal (`Oem.Hpe.*`). Output is the same `HealthSnapshotPayload` contract the
other hardware adapters produce — `source: "HPE_ILO"`. **Read-only** against iLO:
no PATCHes, no `Actions` (CLAUDE.md "no destructive hardware actions in v1").
Build order: Sprint 10.

## What this package does

```
normalizeHpeIloSystem(bundle: HpeIloSystemBundle): HealthSnapshotPayload
```

- Deterministic, no I/O. Delegates `ciCode` / `system` validation and the
  standard Redfish normalization to `redfish-adapter` (so a bad bundle throws
  with the same `.field` semantics; the wrapper re-throws as
  `HpeIloNormalizationError`).
- **`Oem.Hpe.AggregateHealthStatus`** is treated as a _fallback_: a subsystem
  rollup (Fans, Memory, Storage, …) is added to `degraded[]` only when the
  Redfish baseline produced no entry of that kind — i.e. the collector didn't
  fetch that sub-resource. Only `WARNING` / `CRITICAL` rollups are lifted; a
  bare `UNKNOWN` from a partial aggregate is ignored, and a subsystem the
  baseline already flagged from real data is left to the baseline (the specific
  reading wins over the rollup).
- **`Oem.Hpe.SmartStorageBattery`** (the RAID write-cache battery) is surfaced
  as a `degraded` `SYSTEM` component whenever it is not `HEALTHY` — a degraded
  battery forces the array controller to write-through and risks data loss on
  power loss.
- `iloVersion` and `postState` are added to `attributes`; everything else
  (`overallHealth`, `powerState`, `predictiveFailures`, `summary`, `firmware`)
  comes straight from the Redfish baseline. A drive with `FailurePredicted`
  still lifts health to `WARNING` via the baseline.

## Input bundle

Same shape as `RedfishSystemBundle` with an HPE-flavored `system` carrying
`Oem.Hpe`; `smartStorageBattery` may be supplied separately or read from
`system.Oem.Hpe.SmartStorageBattery`. The site collector maps an iLO address to
an OpsDesk CI code and assembles it (see `src/types.ts`).

## Not in this package

The collector's iLO Redfish client, session auth and polling loop; the call that
persists the snapshot (that is `cmdb`'s concern). Runs behind the site collector
over outbound TLS/mTLS — iLO never faces the Internet (spec §11). Tests use
sanitized fixture payloads (spec §21).
