/**
 * Normalized hardware health snapshot (spec §14.x) — the contract between the
 * hardware adapters (`integrations/redfish`, `dell-ome`, HPE iLO; owner Dev B)
 * and the `cmdb` module (owner Dev A), which persists it as the current
 * `HealthSnapshot` for a CI. A compact rollup only: no per-sensor telemetry
 * (that stays in the monitoring platform — CLAUDE.md).
 *
 * Mirrors the `HealthStatus` enum in `./cmdb`.
 */
export type HealthState = "HEALTHY" | "WARNING" | "CRITICAL" | "UNKNOWN" | "MAINTENANCE";

export type HealthSnapshotSource = "REDFISH" | "DELL_OME" | "HPE_ILO" | "SNMP";

export type HealthComponentKind =
  | "SYSTEM"
  | "PROCESSOR"
  | "MEMORY"
  | "STORAGE_CONTROLLER"
  | "DRIVE"
  | "FAN"
  | "POWER_SUPPLY"
  | "TEMPERATURE_SENSOR"
  | "NETWORK";

export interface DegradedComponent {
  kind: HealthComponentKind;
  name: string;
  /** WARNING | CRITICAL | UNKNOWN — healthy components are never listed. */
  health: HealthState;
  detail?: string;
}

export interface PredictiveFailure {
  kind: "DRIVE";
  name: string;
  detail: string;
}

export interface HealthCount {
  total: number;
  healthy: number;
}

export interface HealthSnapshotSummary {
  drives: HealthCount & { predictedFailure: number };
  fans: HealthCount;
  powerSupplies: HealthCount;
}

export interface HealthSnapshotPayload {
  /** OpsDesk CI code the collector attached to this reading. */
  ciCode: string;
  source: HealthSnapshotSource;
  overallHealth: HealthState;
  powerState: "ON" | "OFF" | "UNKNOWN";
  /** ISO-8601 UTC. */
  observedAt: string;
  /** Only components whose health is not HEALTHY. */
  degraded: DegradedComponent[];
  predictiveFailures: PredictiveFailure[];
  summary: HealthSnapshotSummary;
  firmware?: { biosVersion?: string };
  attributes?: Record<string, unknown>;
}
