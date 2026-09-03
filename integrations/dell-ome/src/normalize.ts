import type {
  DegradedComponent,
  HealthComponentKind,
  HealthSnapshotPayload,
  HealthState,
  PredictiveFailure,
} from "@cts-dc-opsdesk/shared-types";
import type {
  DellOmeDeviceBundle,
  OmeDisk,
  OmeFan,
  OmePowerSupply,
  OmeStatusCode,
  OmeSubSystem,
} from "./types";

/** Thrown when an OME bundle cannot be mapped onto the OpsDesk health contract. */
export class DellOmeNormalizationError extends Error {
  constructor(
    message: string,
    readonly field: string,
  ) {
    super(message);
    this.name = "DellOmeNormalizationError";
  }
}

/** One device that failed normalization inside {@link normalizeDellOmeDevices}. */
export interface DellOmeRejection {
  index: number;
  field: string;
  message: string;
}

/**
 * OME status codes → OpsDesk health state. Covers both the REST rollup scale
 * (1000/2000/3000/4000/5000) and the legacy OMSA scale (1–6) that some
 * inventory rows still use.
 */
const OME_STATUS: Record<number, HealthState> = {
  // OME REST rollup scale
  1000: "HEALTHY",
  2000: "UNKNOWN",
  3000: "WARNING",
  4000: "CRITICAL",
  5000: "UNKNOWN",
  // legacy OMSA / SNMP scale
  1: "UNKNOWN", // Other
  2: "UNKNOWN", // Unknown
  3: "HEALTHY", // OK
  4: "WARNING", // Non-Critical
  5: "CRITICAL", // Critical
  6: "CRITICAL", // Non-Recoverable
};

function mapOmeStatus(code: OmeStatusCode | undefined): HealthState {
  return code == null ? "UNKNOWN" : (OME_STATUS[code] ?? "UNKNOWN");
}

const OME_POWER_STATE: Record<number, "ON" | "OFF"> = {
  17: "ON",
  20: "ON", // Powering On
  18: "OFF",
  21: "OFF", // Powering Off
};

function mapPowerState(code: number | undefined): "ON" | "OFF" | "UNKNOWN" {
  return code == null ? "UNKNOWN" : (OME_POWER_STATE[code] ?? "UNKNOWN");
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

/** OME sub-system name → OpsDesk component kind. Voltage / Battery / Current /
 *  System Board have no dedicated kind and roll up to SYSTEM (name is kept). */
const SUBSYSTEM_KIND: Record<string, HealthComponentKind> = {
  temperature: "TEMPERATURE_SENSOR",
  fan: "FAN",
  cooling: "FAN",
  memory: "MEMORY",
  processor: "PROCESSOR",
  cpu: "PROCESSOR",
  storage: "STORAGE_CONTROLLER",
  powersupply: "POWER_SUPPLY",
  "power supply": "POWER_SUPPLY",
  network: "NETWORK",
  nic: "NETWORK",
};

function subsystemKind(name: string | undefined): HealthComponentKind {
  return SUBSYSTEM_KIND[name?.trim().toLowerCase() ?? ""] ?? "SYSTEM";
}

function smartAlertPresent(disk: OmeDisk): boolean {
  return (disk.PredictiveFailureState ?? "").trim().toLowerCase().includes("present");
}

function diskDetail(disk: OmeDisk): string {
  const parts: string[] = [];
  if (disk.MediaType) {
    parts.push(disk.MediaType);
  }
  if (disk.Size) {
    parts.push(disk.Size);
  }
  if (disk.RemainingReadWriteEndurance) {
    parts.push(`${disk.RemainingReadWriteEndurance} endurance left`);
  }
  if (smartAlertPresent(disk)) {
    parts.push("Smart Alert Present");
  }
  return parts.join(", ");
}

function pushIfDegraded(
  into: DegradedComponent[],
  kind: HealthComponentKind,
  name: string,
  status: OmeStatusCode | undefined,
  detail?: string,
): void {
  const health = mapOmeStatus(status);
  if (health !== "HEALTHY" && health !== "MAINTENANCE") {
    into.push({ kind, name, health, detail });
  }
}

function count(items: Array<{ Status?: OmeStatusCode }>): { total: number; healthy: number } {
  let healthy = 0;
  for (const item of items) {
    if (mapOmeStatus(item.Status) === "HEALTHY") {
      healthy += 1;
    }
  }
  return { total: items.length, healthy };
}

/**
 * Normalize one Dell OME device bundle into a compact OpsDesk health snapshot.
 * Pure and deterministic — no I/O. Only non-healthy components are listed;
 * per-sensor telemetry is deliberately dropped (it belongs in the monitoring
 * platform, not the CMDB). Sub-system entries are rollups; disk / PSU / fan
 * entries are the specific parts. Throws {@link DellOmeNormalizationError} when
 * the bundle is unusable.
 */
export function normalizeDellOmeDevice(bundle: DellOmeDeviceBundle): HealthSnapshotPayload {
  const ciCode = bundle.ciCode?.trim();
  if (!ciCode) {
    throw new DellOmeNormalizationError("bundle is missing ciCode", "ciCode");
  }
  if (!bundle.device || typeof bundle.device !== "object") {
    throw new DellOmeNormalizationError(`bundle for ${ciCode} has no device resource`, "device");
  }

  const device = bundle.device;
  const subSystems: OmeSubSystem[] = bundle.subSystems ?? [];
  const disks: OmeDisk[] = bundle.disks ?? [];
  const powerSupplies: OmePowerSupply[] = bundle.powerSupplies ?? [];
  const fans: OmeFan[] = bundle.fans ?? [];

  const degraded: DegradedComponent[] = [];

  pushIfDegraded(
    degraded,
    "SYSTEM",
    device.DeviceName ?? device.DeviceServiceTag ?? "Device",
    device.Status,
  );

  subSystems.forEach((sub, i) => {
    pushIfDegraded(degraded, subsystemKind(sub.Name), sub.Name ?? `SubSystem ${i}`, sub.Status);
  });

  fans.forEach((fan, i) => {
    const detail = typeof fan.Speed === "number" ? `${fan.Speed} RPM` : undefined;
    pushIfDegraded(degraded, "FAN", fan.Name ?? `Fan ${i}`, fan.Status, detail);
  });

  powerSupplies.forEach((psu, i) => {
    const detail = typeof psu.OutputWatts === "number" ? `${psu.OutputWatts}W` : undefined;
    pushIfDegraded(degraded, "POWER_SUPPLY", psu.Name ?? `PSU ${i}`, psu.Status, detail);
  });

  const predictiveFailures: PredictiveFailure[] = [];
  disks.forEach((disk, i) => {
    const name = disk.Name ?? disk.SerialNumber ?? `Disk ${i}`;
    const detail = diskDetail(disk);
    if (smartAlertPresent(disk)) {
      predictiveFailures.push({ kind: "DRIVE", name, detail });
    }
    pushIfDegraded(degraded, "DRIVE", name, disk.Status, detail || undefined);
  });

  const healthInputs: HealthState[] = [
    mapOmeStatus(device.Status),
    ...degraded.map((component) => component.health),
  ];
  if (predictiveFailures.length > 0) {
    healthInputs.push("WARNING");
  }

  return {
    ciCode,
    source: "DELL_OME",
    overallHealth: worst(healthInputs),
    powerState: mapPowerState(device.PowerState),
    observedAt: bundle.observedAt ?? new Date().toISOString(),
    degraded,
    predictiveFailures,
    summary: {
      drives: {
        ...count(disks),
        predictedFailure: disks.filter(smartAlertPresent).length,
      },
      fans: count(fans),
      powerSupplies: count(powerSupplies),
    },
    firmware: bundle.biosVersion ? { biosVersion: bundle.biosVersion } : undefined,
    attributes: {
      serviceTag: device.DeviceServiceTag,
      model: device.Model,
      managementIp: device.ManagementIp,
      omeDeviceId: device.Id,
      connected: device.ConnectionState,
    },
  };
}

/**
 * Normalize a fleet of OME device bundles (one OME poll returns many devices).
 * A device that fails normalization is collected in `rejected`, never thrown —
 * one bad device must not drop the batch.
 */
export function normalizeDellOmeDevices(bundles: DellOmeDeviceBundle[]): {
  snapshots: HealthSnapshotPayload[];
  rejected: DellOmeRejection[];
} {
  const snapshots: HealthSnapshotPayload[] = [];
  const rejected: DellOmeRejection[] = [];

  bundles.forEach((bundle, index) => {
    try {
      snapshots.push(normalizeDellOmeDevice(bundle));
    } catch (err) {
      if (err instanceof DellOmeNormalizationError) {
        rejected.push({ index, field: err.field, message: err.message });
      } else {
        rejected.push({
          index,
          field: "(unknown)",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
  });

  return { snapshots, rejected };
}
