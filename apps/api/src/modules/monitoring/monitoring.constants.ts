import type { HealthSnapshotSource, HealthState } from "@cts-dc-opsdesk/shared-types";

/**
 * Vocabulary for the health-snapshot ingest. Mirrors the enums in
 * `packages/shared-types/src/health.ts`; `HealthSnapshot.overall_health` in the
 * schema is a plain String, so this list is what the DTO validates against.
 */
export const HEALTH_STATES: readonly HealthState[] = [
  "HEALTHY",
  "WARNING",
  "CRITICAL",
  "UNKNOWN",
  "MAINTENANCE",
];

export const HEALTH_SNAPSHOT_SOURCES: readonly HealthSnapshotSource[] = [
  "REDFISH",
  "DELL_OME",
  "HPE_ILO",
  "SNMP",
];

export const POWER_STATES = ["ON", "OFF", "UNKNOWN"] as const;
