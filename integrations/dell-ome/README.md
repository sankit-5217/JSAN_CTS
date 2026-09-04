# Dell OpenManage Enterprise (OME) integration adapter

Owner: Dev B (Integrations, Hardware & Governance). Package: `@cts-dc-opsdesk/dell-ome-adapter`.

Dell-specific enrichment on top of the Redfish baseline (spec §10.12, §12).
Normalizes OME device + inventory JSON for one managed device into the same
`HealthSnapshotPayload` contract (`packages/shared-types/src/health.ts`) the
`redfish-adapter` produces — `source: "DELL_OME"` — so the `cmdb` module (Dev A)
persists it as the CI's current `HealthSnapshot` the same way. **Read-only**
against OME: no jobs, no actions, no firmware/BIOS/power changes
(CLAUDE.md "no destructive hardware actions in v1"). Build order: Sprint 10.

## What this package does

```
normalizeDellOmeDevice(bundle: DellOmeDeviceBundle): HealthSnapshotPayload
normalizeDellOmeDevices(bundles: DellOmeDeviceBundle[]): { snapshots, rejected }
```

- Deterministic, no I/O. Throws `DellOmeNormalizationError` (with `.field`) when
  the bundle has no `ciCode` or no `device`. The batch form collects those as
  `rejected: { index, field, message }[]` instead of throwing — one bad device
  never drops an OME poll.
- Maps OME status codes to health: REST rollup scale (`1000` Normal, `2000`
  Unknown, `3000` Warning, `4000` Critical, `5000` No status) **and** the legacy
  OMSA scale (`1` Other, `2` Unknown, `3` OK, `4` Non-Critical, `5` Critical,
  `6` Non-Recoverable) that some inventory rows still carry. Anything else is
  `UNKNOWN`.
- Overall health is the worst of the device rollup, every degraded component and
  any predictive drive failure.
- **Compact by design**: only non-healthy components appear in `degraded[]`.
  Sub-system entries (`SubSystemHealth`) are rollups; `disks` / `powerSupplies` /
  `fans` entries are the specific parts — both are kept, `name` disambiguates.
  Sub-systems with no dedicated `HealthComponentKind` (Voltage, Battery, Current,
  System Board) roll up to `SYSTEM` with their name preserved.
- A disk whose `PredictiveFailureState` contains "Present" (SMART alert) becomes
  a `predictiveFailures[]` entry and lifts overall health to at least `WARNING` —
  the disk-failure path in the first integration demo (spec §31, step 4).
- Power state: OME codes `17`/`20` → `ON`, `18`/`21` → `OFF`, else `UNKNOWN`.

## Input bundle

The site collector maps an OME-managed device to an OpsDesk CI code, then
gathers `Devices(Id)` + `SubSystemHealth` + the flattened disk / PSU / fan rows
from `InventoryDetails` (and BIOS version from `deviceSoftware`) into a
`DellOmeDeviceBundle` (see `src/types.ts`) and hands it here.

## Not in this package

The collector's OME REST client, session auth (`X-Auth-Token`) and polling loop;
the call that persists the snapshot (that is `cmdb`'s concern). Runs behind the
site collector over outbound TLS/mTLS — the OME appliance and management ports
never face the Internet (spec §11). OME's alert stream
(`/api/AlertService/Alerts` → `NormalizedAlertPayload`) is a separate follow-up,
the same way `zabbix-adapter` and `prometheus-adapter` are separate from this.
Tests use sanitized fixture payloads (spec §21).
