import { normalizeRedfishSystem } from "@cts-dc-opsdesk/redfish-adapter";
import type { RedfishStatus } from "@cts-dc-opsdesk/redfish-adapter";
import type {
  DegradedComponent,
  HealthComponentKind,
  HealthSnapshotPayload,
  HealthState,
} from "@cts-dc-opsdesk/shared-types";
import type { HpeAggregateHealthStatus, HpeIloSystemBundle, HpeSmartStorageBattery } from "./types";

/** Thrown when an iLO bundle cannot be mapped onto the OpsDesk health contract. */
export class HpeIloNormalizationError extends Error {
  constructor(
    message: string,
    readonly field: string,
  ) {
    super(message);
    this.name = "HpeIloNormalizationError";
  }
}

/** Redfish `Health` ("OK" | "Warning" | "Critical") → OpsDesk health state
 *  (same mapping as `redfish-adapter`, kept local — it is not exported there). */
function mapHealth(status: RedfishStatus | undefined): HealthState {
  const raw = (status?.HealthRollup ?? status?.Health)?.trim().toLowerCase();
  if (raw === "ok") {
    return "HEALTHY";
  }
  if (raw === "warning") {
    return "WARNING";
  }
  if (raw === "critical") {
    return "CRITICAL";
  }
  return "UNKNOWN";
}

const RANK: Record<HealthState, number> = {
  UNKNOWN: 0,
  HEALTHY: 1,
  MAINTENANCE: 1,
  WARNING: 2,
  CRITICAL: 3,
};

function worst(states: HealthState[]): HealthState {
  let winner: HealthState = "UNKNOWN";
  for (const state of states) {
    if (RANK[state] > RANK[winner]) {
      winner = state;
    }
  }
  return winner;
}

/** `Oem.Hpe.AggregateHealthStatus` field → OpsDesk component kind. */
const AGG_SUBSYSTEMS: ReadonlyArray<[keyof HpeAggregateHealthStatus, HealthComponentKind]> = [
  ["BiosOrHardwareHealth", "SYSTEM"],
  ["Fans", "FAN"],
  ["Memory", "MEMORY"],
  ["Network", "NETWORK"],
  ["PowerSupplies", "POWER_SUPPLY"],
  ["Processors", "PROCESSOR"],
  ["SmartStorageBattery", "SYSTEM"],
  ["Storage", "STORAGE_CONTROLLER"],
  ["Temperatures", "TEMPERATURE_SENSOR"],
];

function batteryDetail(bat: HpeSmartStorageBattery): string {
  const parts: string[] = [];
  if (bat.ProductName) {
    parts.push(bat.ProductName);
  }
  if (typeof bat.RemainingChargePercent === "number") {
    parts.push(`${bat.RemainingChargePercent}% charge`);
  }
  if (bat.Charging) {
    parts.push("charging");
  }
  return parts.join(", ");
}

/**
 * Normalize one HPE iLO system bundle into a compact OpsDesk health snapshot.
 * Pure and deterministic — no I/O. Delegates the standard Redfish fields to
 * `@cts-dc-opsdesk/redfish-adapter`, then layers on the HPE OEM signal:
 *
 * - `Oem.Hpe.AggregateHealthStatus` is a **fallback** — a subsystem rollup is
 *   only added when the Redfish baseline produced no `degraded` entry of that
 *   kind (the collector didn't fetch that sub-resource). Only WARNING / CRITICAL
 *   rollups are lifted; a bare UNKNOWN from a partial aggregate is ignored.
 * - `Oem.Hpe.SmartStorageBattery` (the RAID write-cache battery) is surfaced as
 *   a `degraded` SYSTEM component whenever it is not HEALTHY.
 *
 * Throws {@link HpeIloNormalizationError} when the bundle is unusable.
 */
export function normalizeHpeIloSystem(bundle: HpeIloSystemBundle): HealthSnapshotPayload {
  const ciCode = bundle.ciCode?.trim();
  if (!ciCode) {
    throw new HpeIloNormalizationError("bundle is missing ciCode", "ciCode");
  }
  if (!bundle.system || typeof bundle.system !== "object") {
    throw new HpeIloNormalizationError(`bundle for ${ciCode} has no system resource`, "system");
  }

  const base = normalizeRedfishSystem({
    ciCode,
    system: bundle.system,
    thermal: bundle.thermal,
    power: bundle.power,
    drives: bundle.drives,
    observedAt: bundle.observedAt,
  });

  const hpe = bundle.system.Oem?.Hpe;
  const extraDegraded: DegradedComponent[] = [];

  const agg = hpe?.AggregateHealthStatus;
  if (agg) {
    const flaggedKinds = new Set(base.degraded.map((component) => component.kind));
    for (const [field, kind] of AGG_SUBSYSTEMS) {
      if (flaggedKinds.has(kind)) {
        continue;
      }
      const health = mapHealth(agg[field]?.Status);
      if (health === "WARNING" || health === "CRITICAL") {
        extraDegraded.push({ kind, name: `Hpe.AggregateHealthStatus.${String(field)}`, health });
      }
    }
  }

  const batteries = bundle.smartStorageBattery ?? hpe?.SmartStorageBattery ?? [];
  batteries.forEach((bat, i) => {
    const health = mapHealth(bat.Status);
    if (health !== "HEALTHY" && health !== "MAINTENANCE") {
      extraDegraded.push({
        kind: "SYSTEM",
        name: bat.ProductName ?? `SmartStorageBattery ${bat.Index ?? i}`,
        health,
        detail: batteryDetail(bat) || undefined,
      });
    }
  });

  const attributes = {
    ...(base.attributes ?? {}),
    ...(hpe?.IloVersion ? { iloVersion: hpe.IloVersion } : {}),
    ...(hpe?.PostState ? { postState: hpe.PostState } : {}),
  };

  if (extraDegraded.length === 0) {
    return { ...base, source: "HPE_ILO", attributes };
  }

  const degraded = [...base.degraded, ...extraDegraded];
  return {
    ...base,
    source: "HPE_ILO",
    overallHealth: worst([base.overallHealth, ...extraDegraded.map((d) => d.health)]),
    degraded,
    attributes,
  };
}
