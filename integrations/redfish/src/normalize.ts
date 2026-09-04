import type {
  DegradedComponent,
  HealthComponentKind,
  HealthSnapshotPayload,
  HealthState,
  PredictiveFailure,
} from "@cts-dc-opsdesk/shared-types";
import type {
  RedfishComputerSystem,
  RedfishDrive,
  RedfishFan,
  RedfishPowerSupply,
  RedfishStatus,
  RedfishSystemBundle,
  RedfishTemperature,
} from "./types";

/** Thrown when a Redfish bundle cannot be mapped onto the OpsDesk health contract. */
export class RedfishNormalizationError extends Error {
  constructor(
    message: string,
    readonly field: string,
  ) {
    super(message);
    this.name = "RedfishNormalizationError";
  }
}

/** Redfish `Health` ("OK" | "Warning" | "Critical") -> OpsDesk health state. */
function mapHealth(status: RedfishStatus | undefined, preferRollup = false): HealthState {
  const raw = (preferRollup ? (status?.HealthRollup ?? status?.Health) : status?.Health)
    ?.trim()
    .toLowerCase();
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

const POWER_STATE: Record<string, "ON" | "OFF"> = {
  on: "ON",
  poweringon: "ON",
  off: "OFF",
  poweringoff: "OFF",
};

function mapPowerState(raw: string | undefined): "ON" | "OFF" | "UNKNOWN" {
  return POWER_STATE[raw?.trim().toLowerCase() ?? ""] ?? "UNKNOWN";
}

/** A component reported as physically absent is not "degraded" — just skip it. */
function isAbsent(status: RedfishStatus | undefined): boolean {
  return status?.State?.trim().toLowerCase() === "absent";
}

function pushIfDegraded(
  into: DegradedComponent[],
  kind: HealthComponentKind,
  name: string,
  status: RedfishStatus | undefined,
  detail?: string,
): void {
  if (isAbsent(status)) {
    return;
  }
  const health = mapHealth(status);
  if (health !== "HEALTHY") {
    into.push({ kind, name, health, detail });
  }
}

function driveDetail(drive: RedfishDrive): string {
  const parts: string[] = [];
  if (drive.MediaType) {
    parts.push(drive.MediaType);
  }
  if (typeof drive.PredictedMediaLifeLeftPercent === "number") {
    parts.push(`${drive.PredictedMediaLifeLeftPercent}% media life left`);
  }
  if (drive.FailurePredicted) {
    parts.push("FailurePredicted");
  }
  return parts.join(", ");
}

/**
 * Normalize one Redfish system bundle into a compact OpsDesk health snapshot.
 * Pure and deterministic — no I/O. Only non-healthy components are listed;
 * per-sensor telemetry is deliberately dropped (it belongs in the monitoring
 * platform, not the CMDB). Throws {@link RedfishNormalizationError} when the
 * bundle is unusable.
 */
export function normalizeRedfishSystem(bundle: RedfishSystemBundle): HealthSnapshotPayload {
  const ciCode = bundle.ciCode?.trim();
  if (!ciCode) {
    throw new RedfishNormalizationError("bundle is missing ciCode", "ciCode");
  }
  if (!bundle.system || typeof bundle.system !== "object") {
    throw new RedfishNormalizationError(`bundle for ${ciCode} has no system resource`, "system");
  }

  const system: RedfishComputerSystem = bundle.system;
  const temperatures: RedfishTemperature[] = bundle.thermal?.Temperatures ?? [];
  const fans: RedfishFan[] = bundle.thermal?.Fans ?? [];
  const powerSupplies: RedfishPowerSupply[] = bundle.power?.PowerSupplies ?? [];
  const drives: RedfishDrive[] = bundle.drives ?? [];

  const degraded: DegradedComponent[] = [];

  pushIfDegraded(degraded, "SYSTEM", system.Name ?? system.Id ?? "System", system.Status);
  pushIfDegraded(degraded, "PROCESSOR", "ProcessorSummary", system.ProcessorSummary?.Status);
  pushIfDegraded(degraded, "MEMORY", "MemorySummary", system.MemorySummary?.Status);

  temperatures.forEach((temp, i) => {
    const over =
      typeof temp.ReadingCelsius === "number" &&
      typeof temp.UpperThresholdCritical === "number" &&
      temp.ReadingCelsius >= temp.UpperThresholdCritical;
    const name = temp.Name ?? `Temperature ${i}`;
    const reading = typeof temp.ReadingCelsius === "number" ? `${temp.ReadingCelsius}C` : undefined;
    if (over && !isAbsent(temp.Status)) {
      degraded.push({
        kind: "TEMPERATURE_SENSOR",
        name,
        health: "CRITICAL",
        detail: `${reading ?? "?"} >= critical ${temp.UpperThresholdCritical}C`,
      });
      return;
    }
    pushIfDegraded(degraded, "TEMPERATURE_SENSOR", name, temp.Status, reading);
  });

  fans.forEach((fan, i) => {
    const reading =
      typeof fan.Reading === "number" ? `${fan.Reading}${fan.ReadingUnits ?? ""}` : undefined;
    pushIfDegraded(degraded, "FAN", fan.Name ?? `Fan ${i}`, fan.Status, reading);
  });

  powerSupplies.forEach((psu, i) => {
    pushIfDegraded(degraded, "POWER_SUPPLY", psu.Name ?? `PSU ${i}`, psu.Status);
  });

  const predictiveFailures: PredictiveFailure[] = [];
  drives.forEach((drive, i) => {
    const name = drive.Name ?? drive.SerialNumber ?? `Drive ${i}`;
    if (drive.FailurePredicted === true) {
      predictiveFailures.push({ kind: "DRIVE", name, detail: driveDetail(drive) });
    }
    pushIfDegraded(degraded, "DRIVE", name, drive.Status, driveDetail(drive) || undefined);
  });

  const healthInputs: HealthState[] = [
    mapHealth(system.Status, true),
    ...degraded.map((component) => component.health),
  ];
  if (predictiveFailures.length > 0) {
    healthInputs.push("WARNING");
  }
  const overallHealth = worst(healthInputs);

  return {
    ciCode,
    source: "REDFISH",
    overallHealth,
    powerState: mapPowerState(system.PowerState),
    observedAt: bundle.observedAt ?? new Date().toISOString(),
    degraded,
    predictiveFailures,
    summary: {
      drives: countDrives(drives),
      fans: count(fans, (f) => f.Status),
      powerSupplies: count(powerSupplies, (p) => p.Status),
    },
    firmware: system.BiosVersion ? { biosVersion: system.BiosVersion } : undefined,
    attributes: {
      manufacturer: system.Manufacturer,
      model: system.Model,
      serialNumber: system.SerialNumber,
    },
  };
}

function count<T>(
  items: T[],
  statusOf: (item: T) => RedfishStatus | undefined,
): { total: number; healthy: number } {
  let total = 0;
  let healthy = 0;
  for (const item of items) {
    const status = statusOf(item);
    if (isAbsent(status)) {
      continue;
    }
    total += 1;
    if (mapHealth(status) === "HEALTHY") {
      healthy += 1;
    }
  }
  return { total, healthy };
}

function countDrives(drives: RedfishDrive[]): {
  total: number;
  healthy: number;
  predictedFailure: number;
} {
  const base = count(drives, (d) => d.Status);
  const predictedFailure = drives.filter((d) => d.FailurePredicted === true).length;
  return { ...base, predictedFailure };
}
