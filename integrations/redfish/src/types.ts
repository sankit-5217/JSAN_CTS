/**
 * Minimal shapes for the Redfish resources OpsDesk reads (DMTF Redfish schema,
 * common subset across iDRAC / iLO / OpenBMC). All fields optional — real BMCs
 * vary in what they populate. Read-only: OpsDesk never PATCHes or POSTs actions
 * (CLAUDE.md "no destructive hardware actions in v1").
 */
export interface RedfishStatus {
  /** "Enabled" | "Disabled" | "Absent" | "StandbyOffline" | "UnavailableOffline" | ... */
  State?: string;
  /** "OK" | "Warning" | "Critical" */
  Health?: string;
  /** Aggregated health of this resource and its subordinates. */
  HealthRollup?: string;
}

export interface RedfishResourceSummary {
  Count?: number;
  TotalSystemMemoryGiB?: number;
  Status?: RedfishStatus;
}

/** `/redfish/v1/Systems/{id}` */
export interface RedfishComputerSystem {
  Id?: string;
  Name?: string;
  Manufacturer?: string;
  Model?: string;
  SerialNumber?: string;
  SKU?: string;
  /** "On" | "Off" | "PoweringOn" | "PoweringOff" */
  PowerState?: string;
  BiosVersion?: string;
  Status?: RedfishStatus;
  ProcessorSummary?: RedfishResourceSummary;
  MemorySummary?: RedfishResourceSummary;
}

export interface RedfishTemperature {
  Name?: string;
  ReadingCelsius?: number;
  UpperThresholdCritical?: number;
  Status?: RedfishStatus;
}

export interface RedfishFan {
  Name?: string;
  Reading?: number;
  ReadingUnits?: string;
  Status?: RedfishStatus;
}

/** `/redfish/v1/Chassis/{id}/Thermal` */
export interface RedfishThermal {
  Temperatures?: RedfishTemperature[];
  Fans?: RedfishFan[];
}

export interface RedfishPowerSupply {
  Name?: string;
  PowerInputWatts?: number;
  LineInputVoltage?: number;
  Status?: RedfishStatus;
}

/** `/redfish/v1/Chassis/{id}/Power` */
export interface RedfishPower {
  PowerSupplies?: RedfishPowerSupply[];
  PowerControl?: { PowerConsumedWatts?: number }[];
}

/** `/redfish/v1/Systems/{id}/Storage/{id}/Drives/{id}` */
export interface RedfishDrive {
  Name?: string;
  Model?: string;
  SerialNumber?: string;
  /** "HDD" | "SSD" | ... */
  MediaType?: string;
  Protocol?: string;
  CapacityBytes?: number;
  FailurePredicted?: boolean;
  PredictedMediaLifeLeftPercent?: number;
  Status?: RedfishStatus;
}

/**
 * What the site collector gathers for one system in a single poll and hands to
 * {@link normalizeRedfishSystem}. `drives` is flattened across all storage
 * controllers.
 */
export interface RedfishSystemBundle {
  /** OpsDesk CI code — the collector maps BMC address -> CI before calling. */
  ciCode: string;
  system: RedfishComputerSystem;
  thermal?: RedfishThermal;
  power?: RedfishPower;
  drives?: RedfishDrive[];
  /** ISO-8601; defaults to now. */
  observedAt?: string;
}
