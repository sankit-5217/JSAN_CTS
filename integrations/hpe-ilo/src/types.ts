import type {
  RedfishComputerSystem,
  RedfishDrive,
  RedfishPower,
  RedfishStatus,
  RedfishThermal,
} from "@cts-dc-opsdesk/redfish-adapter";

/**
 * HPE iLO speaks standard DMTF Redfish, so the common health fields are handled
 * by `@cts-dc-opsdesk/redfish-adapter`. This package adds the HPE OEM extensions
 * (`Oem.Hpe.*`) that carry HPE-specific signal — the aggregate subsystem rollup
 * and the Smart Storage (write-cache) battery. Read-only: OpsDesk never PATCHes
 * iLO or invokes `Actions` (CLAUDE.md "no destructive hardware actions in v1").
 */

/** `Oem.Hpe.AggregateHealthStatus` — one rollup per subsystem, each `{ Status }`. */
export interface HpeAggregateHealthStatus {
  BiosOrHardwareHealth?: { Status?: RedfishStatus };
  Fans?: { Status?: RedfishStatus };
  Memory?: { Status?: RedfishStatus };
  Network?: { Status?: RedfishStatus };
  PowerSupplies?: { Status?: RedfishStatus };
  Processors?: { Status?: RedfishStatus };
  SmartStorageBattery?: { Status?: RedfishStatus };
  Storage?: { Status?: RedfishStatus };
  Temperatures?: { Status?: RedfishStatus };
}

/**
 * `Oem.Hpe.SmartStorageBattery[]` — the RAID write-cache battery. A degraded one
 * drops the array controller to write-through (a performance cliff) and risks
 * data loss on power loss, so a non-healthy entry is surfaced as `degraded`.
 */
export interface HpeSmartStorageBattery {
  Index?: number;
  ProductName?: string;
  Model?: string;
  SerialNumber?: string;
  Charging?: boolean;
  RemainingChargePercent?: number;
  Status?: RedfishStatus;
  /** iLO error code, e.g. low charge / failure predicted. */
  ErrorCode?: number;
}

export interface HpeSystemOem {
  Hpe?: {
    AggregateHealthStatus?: HpeAggregateHealthStatus;
    SmartStorageBattery?: HpeSmartStorageBattery[];
    /** "FinishedPost" | "InPost" | "PowerOff" | … */
    PostState?: string;
    /** iLO firmware version string, e.g. "iLO 5 v2.78". */
    IloVersion?: string;
  };
}

/** `/redfish/v1/Systems/{id}` on HPE hardware — standard system plus `Oem.Hpe`. */
export interface HpeRedfishComputerSystem extends RedfishComputerSystem {
  Oem?: HpeSystemOem;
}

/**
 * What the site collector gathers for one iLO-managed system in a single poll
 * and hands to {@link normalizeHpeIloSystem}. Same shape as `RedfishSystemBundle`
 * with an HPE-flavored `system`; `smartStorageBattery` may be supplied separately
 * or read from `system.Oem.Hpe.SmartStorageBattery`.
 */
export interface HpeIloSystemBundle {
  /** OpsDesk CI code — the collector maps the iLO address → CI before calling. */
  ciCode: string;
  system: HpeRedfishComputerSystem;
  thermal?: RedfishThermal;
  power?: RedfishPower;
  drives?: RedfishDrive[];
  smartStorageBattery?: HpeSmartStorageBattery[];
  /** ISO-8601; defaults to now. */
  observedAt?: string;
}
