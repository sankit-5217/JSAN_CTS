/**
 * Minimal shapes for the Dell OpenManage Enterprise (OME) REST resources OpsDesk
 * reads (`/api/DeviceService/Devices`, `.../SubSystemHealth`, `.../InventoryDetails`).
 * All fields optional — OME versions and device types vary in what they populate.
 * Read-only: OpsDesk never POSTs jobs or actions to OME
 * (CLAUDE.md "no destructive hardware actions in v1", spec §10.12).
 */

/**
 * OME numeric health rollup, used by `Device.Status` and each `SubSystem.Status`.
 * REST scale: 1000 Normal, 2000 Unknown, 3000 Warning, 4000 Critical, 5000 No status.
 * Some inventory rows still carry the legacy OMSA scale (1 Other, 2 Unknown, 3 OK,
 * 4 Non-Critical, 5 Critical, 6 Non-Recoverable) — `normalize` handles both.
 */
export type OmeStatusCode = number;

/** `GET /api/DeviceService/Devices` element. */
export interface OmeDevice {
  Id?: number;
  DeviceServiceTag?: string;
  DeviceName?: string;
  Model?: string;
  /** OME device-type code (1000 = server, 2000 = chassis, 3000 = network, 4000 = storage…). */
  Type?: number;
  Status?: OmeStatusCode;
  /** OME power-state code: 17 On, 18 Off, 20 Powering On, 21 Powering Off. */
  PowerState?: number;
  /** false when OME currently cannot reach the device. */
  ConnectionState?: boolean;
  /** Management address the collector resolved the CI from. */
  ManagementIp?: string;
}

/** One row of `GET /api/DeviceService/Devices(Id)/SubSystemHealth` → `SubSystems[]`. */
export interface OmeSubSystem {
  /** "Temperature" | "Fan" | "Memory" | "Processor" | "Storage" | "PowerSupply" |
   *  "Voltage" | "Battery" | "System Board" | "Network" | … */
  Name?: string;
  Status?: OmeStatusCode;
}

/** Physical disk from `InventoryDetails` (`serverStorageDisks` / `deviceDisk`). */
export interface OmeDisk {
  Id?: string;
  Name?: string;
  SerialNumber?: string;
  ModelNumber?: string;
  /** "SSD" | "HDD" | "HDD SAS" | … */
  MediaType?: string;
  Status?: OmeStatusCode;
  /** "Smart Alert Present" → predictive failure; "Smart Alert Absent" / absent → ok. */
  PredictiveFailureState?: string;
  /** e.g. "97 %" — SSD write endurance remaining. */
  RemainingReadWriteEndurance?: string;
  /** e.g. "894 GB". */
  Size?: string;
}

/** Power supply from `InventoryDetails` (`serverPowerSupplies`). */
export interface OmePowerSupply {
  Name?: string;
  SerialNumber?: string;
  Status?: OmeStatusCode;
  OutputWatts?: number;
}

/** Fan from `InventoryDetails` (OME often omits per-fan detail — the "Fan"
 *  sub-system rollup still covers health when this list is absent). */
export interface OmeFan {
  Name?: string;
  Status?: OmeStatusCode;
  Speed?: number;
}

/**
 * What the site collector gathers for one OME-managed device in a single poll
 * and hands to {@link normalizeDellOmeDevice}. `disks` / `powerSupplies` / `fans`
 * are flattened from `InventoryDetails`.
 */
export interface DellOmeDeviceBundle {
  /** OpsDesk CI code — the collector maps the OME device → CI before calling. */
  ciCode: string;
  device: OmeDevice;
  /** Sub-system health rollup for the device. */
  subSystems?: OmeSubSystem[];
  disks?: OmeDisk[];
  powerSupplies?: OmePowerSupply[];
  fans?: OmeFan[];
  /** BIOS version from `InventoryDetails` (`deviceSoftware`). */
  biosVersion?: string;
  /** ISO-8601; defaults to now. */
  observedAt?: string;
}
