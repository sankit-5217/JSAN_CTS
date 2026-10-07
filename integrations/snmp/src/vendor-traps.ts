import type { NormalizedAlertPayload } from "@cts-dc-opsdesk/shared-types";
import type { SnmpTrapVarbind } from "./types";

/**
 * Hardware-fault traps from Dell iDRAC (IDRAC-MIB-SMIv2) and HPE ProLiant /
 * iLO agents (CPQIDA-MIB, CPQHLTH-MIB, CPQSTDEQ-MIB). Every OID and enum value
 * below is taken from those MIB files (LibreNMS mirror,
 * github.com/librenms/librenms/tree/master/mibs/{dell,hp}).
 *
 * Fault, warning and recovery variants of one condition share an `alertType`,
 * and the component key comes from the same varbind in each, so a recovery
 * trap's fingerprint matches the fault it clears.
 */

type Severity = NormalizedAlertPayload["severity"];
type State = NormalizedAlertPayload["state"];

export interface VendorTrapClassification {
  vendor: "DELL_IDRAC" | "HPE";
  /** MIB trap name, e.g. `alertStoragePhysicalDiskFailure`. */
  trapName: string;
  alertType: string;
  severity: Severity;
  state: State;
  componentKey?: string;
  /** Human-readable detail for the alert summary (message text, location, serial). */
  detail?: string;
}

/** Varbind lookup by OID prefix. Table columns arrive with their row index
 *  appended (`<column>.<cntlr>.<drive>`) and scalars may carry a `.0`. */
function find(
  varbinds: SnmpTrapVarbind[],
  prefix: string,
): { value: string; suffix: string } | undefined {
  for (const vb of varbinds) {
    const oid = vb.oid?.trim();
    if (!oid || (oid !== prefix && !oid.startsWith(`${prefix}.`))) {
      continue;
    }
    const value = vb.value == null ? "" : String(vb.value).trim();
    return { value, suffix: oid.slice(prefix.length + 1) };
  }
  return undefined;
}

function intValue(varbinds: SnmpTrapVarbind[], prefix: string): number | undefined {
  const hit = find(varbinds, prefix);
  if (!hit) {
    return undefined;
  }
  const n = Number(hit.value);
  return Number.isInteger(n) ? n : undefined;
}

/**
 * Row index of the first varbind under any of these prefixes. A prefix is
 * either a table column (`...Entry.<col>` -> the suffix is the index) or a
 * whole table entry (`...Entry` -> drop the leading column arc first), so a
 * trap can be keyed by whichever column of the row it happens to carry.
 */
function rowIndex(varbinds: SnmpTrapVarbind[], ...prefixes: string[]): string | undefined {
  for (const prefix of prefixes) {
    const hit = find(varbinds, prefix);
    if (!hit?.suffix) {
      continue;
    }
    const index = TABLE_ENTRIES.has(prefix) ? hit.suffix.split(".").slice(1).join(".") : hit.suffix;
    if (index) {
      return index;
    }
  }
  return undefined;
}

function joinDetail(...parts: Array<string | undefined>): string | undefined {
  const kept = parts.filter((p): p is string => Boolean(p && p.trim()));
  return kept.length > 0 ? kept.join(", ") : undefined;
}

// --- Dell iDRAC -------------------------------------------------------------

const IDRAC_SYSTEM_TRAPS = "1.3.6.1.4.1.674.10892.5.3.2.1.0";
const IDRAC_STORAGE_TRAPS = "1.3.6.1.4.1.674.10892.5.3.2.2.0";
const IDRAC_VB = {
  messageId: "1.3.6.1.4.1.674.10892.5.3.1.1",
  message: "1.3.6.1.4.1.674.10892.5.3.1.2",
  currentStatus: "1.3.6.1.4.1.674.10892.5.3.1.3",
  serviceTag: "1.3.6.1.4.1.674.10892.5.3.1.4",
  fqdd: "1.3.6.1.4.1.674.10892.5.3.1.6",
  deviceDisplayName: "1.3.6.1.4.1.674.10892.5.3.1.7",
};
/** IDRAC ObjectStatusEnum ok(3). */
const IDRAC_STATUS_OK = 3;

/**
 * - "fault"/"warn": opens (or updates) the condition at that severity.
 * - "normal": an explicit recovery trap (the MIB's `...Normal`).
 * - "info": a generic informational event (rebuild, insert, ...). Only a
 *   recovery when `alertCurrentStatus` is ok(3); otherwise an INFO alert.
 */
type IdracKind = "fault" | "warn" | "normal" | "info";

interface IdracTrap {
  name: string;
  alertType: string;
  kind: IdracKind;
  severity: Severity;
}

function idracFamily(
  base: string,
  first: number,
  stem: string,
  alertType: string,
  faultSeverity: Severity,
  warnSeverity: Severity,
  third: "normal" | "info",
): Array<[string, IdracTrap]> {
  const thirdName = third === "normal" ? "Normal" : "Information";
  return [
    [
      `${base}.${first}`,
      { name: `${stem}Failure`, alertType, kind: "fault", severity: faultSeverity },
    ],
    [
      `${base}.${first + 1}`,
      { name: `${stem}Warning`, alertType, kind: "warn", severity: warnSeverity },
    ],
    [
      `${base}.${first + 2}`,
      { name: `${stem}${thirdName}`, alertType, kind: third, severity: "INFO" },
    ],
  ];
}

const IDRAC_TRAPS: ReadonlyMap<string, IdracTrap> = new Map<string, IdracTrap>([
  // Physical disk: the MIB defines it in both the system and storage groups.
  ...idracFamily(
    IDRAC_SYSTEM_TRAPS,
    2297,
    "alertPhysicalDisk",
    "hardware.drive_fault",
    "CRITICAL",
    "WARNING",
    "info",
  ),
  ...idracFamily(
    IDRAC_STORAGE_TRAPS,
    4345,
    "alertStoragePhysicalDisk",
    "hardware.drive_fault",
    "CRITICAL",
    "WARNING",
    "info",
  ),
  ...idracFamily(
    IDRAC_STORAGE_TRAPS,
    4353,
    "alertStorageVirtualDisk",
    "hardware.virtual_disk_fault",
    "CRITICAL",
    "HIGH",
    "info",
  ),
  ...idracFamily(
    IDRAC_STORAGE_TRAPS,
    4329,
    "alertStorageController",
    "hardware.storage_controller_fault",
    "CRITICAL",
    "WARNING",
    "info",
  ),
  ...idracFamily(
    IDRAC_STORAGE_TRAPS,
    4273,
    "alertStorageBattery",
    "hardware.storage_battery_fault",
    "HIGH",
    "WARNING",
    "info",
  ),
  ...idracFamily(
    IDRAC_STORAGE_TRAPS,
    4337,
    "alertStorageEnclosure",
    "hardware.storage_enclosure_fault",
    "HIGH",
    "WARNING",
    "info",
  ),
  ...idracFamily(
    IDRAC_SYSTEM_TRAPS,
    2225,
    "alertBattery",
    "hardware.battery_fault",
    "HIGH",
    "WARNING",
    "normal",
  ),
  ...idracFamily(
    IDRAC_SYSTEM_TRAPS,
    2185,
    "alertPowerSupply",
    "hardware.power_supply_fault",
    "CRITICAL",
    "WARNING",
    "normal",
  ),
  ...idracFamily(
    IDRAC_SYSTEM_TRAPS,
    2473,
    "alertRedundancy",
    "hardware.redundancy_lost",
    "HIGH",
    "WARNING",
    "info",
  ),
  ...idracFamily(
    IDRAC_SYSTEM_TRAPS,
    2153,
    "alertFan",
    "hardware.fan_fault",
    "HIGH",
    "WARNING",
    "info",
  ),
  ...idracFamily(
    IDRAC_SYSTEM_TRAPS,
    2161,
    "alertTemperatureProbe",
    "hardware.temperature_fault",
    "CRITICAL",
    "WARNING",
    "normal",
  ),
  ...idracFamily(
    IDRAC_SYSTEM_TRAPS,
    2169,
    "alertVoltageProbe",
    "hardware.voltage_fault",
    "CRITICAL",
    "WARNING",
    "normal",
  ),
  ...idracFamily(
    IDRAC_SYSTEM_TRAPS,
    2265,
    "alertMemoryDevice",
    "hardware.memory_fault",
    "CRITICAL",
    "WARNING",
    "info",
  ),
  ...idracFamily(
    IDRAC_SYSTEM_TRAPS,
    2241,
    "alertProcessorDeviceStatus",
    "hardware.processor_fault",
    "CRITICAL",
    "WARNING",
    "normal",
  ),
  // "Absent" traps share the alertType of their component so the Normal trap clears them.
  [
    `${IDRAC_SYSTEM_TRAPS}.2465`,
    {
      name: "alertPowerSupplyAbsent",
      alertType: "hardware.power_supply_fault",
      kind: "fault",
      severity: "HIGH",
    },
  ],
  [
    `${IDRAC_SYSTEM_TRAPS}.2457`,
    {
      name: "alertProcessorDeviceAbsent",
      alertType: "hardware.processor_fault",
      kind: "fault",
      severity: "HIGH",
    },
  ],
]);

function classifyIdrac(trap: IdracTrap, varbinds: SnmpTrapVarbind[]): VendorTrapClassification {
  const fqdd = find(varbinds, IDRAC_VB.fqdd)?.value || undefined;
  const display = find(varbinds, IDRAC_VB.deviceDisplayName)?.value || undefined;
  const messageId = find(varbinds, IDRAC_VB.messageId)?.value || undefined;
  const message = find(varbinds, IDRAC_VB.message)?.value || undefined;
  const status = intValue(varbinds, IDRAC_VB.currentStatus);

  let state: State = "OPEN";
  if (trap.kind === "normal" || (trap.kind === "info" && status === IDRAC_STATUS_OK)) {
    state = "RECOVERED";
  }

  return {
    vendor: "DELL_IDRAC",
    trapName: trap.name,
    alertType: trap.alertType,
    severity: trap.severity,
    state,
    componentKey: fqdd ?? display,
    detail: joinDetail(
      messageId && message ? `[${messageId}] ${message}` : message,
      display && display !== fqdd ? display : undefined,
    ),
  };
}

// --- HPE (Compaq enterprise 1.3.6.1.4.1.232) ----------------------------------

/** SNMPv1 TRAP-TYPE under ENTERPRISE compaq -> `1.3.6.1.4.1.232.0.<n>` (RFC 3584 §3.1).
 *  The oldest drive-array / health traps use ENTERPRISE cpqDriveArray (232.3) /
 *  cpqHealth (232.6) instead, so their OIDs are spelled out in full. */
const cpq = (n: number) => `1.3.6.1.4.1.232.0.${n}`;

const HPE_COL = {
  phyDrv: "1.3.6.1.4.1.232.3.2.5.1.1",
  phyDrvStatus: "1.3.6.1.4.1.232.3.2.5.1.1.6",
  phyDrvSerial: "1.3.6.1.4.1.232.3.2.5.1.1.51",
  phyDrvLocation: "1.3.6.1.4.1.232.3.2.5.1.1.64",
  phyDrvBay: "1.3.6.1.4.1.232.3.2.5.1.1.5",
  phyDrvSsdWear: "1.3.6.1.4.1.232.3.2.5.1.1.73",
  logDrvStatus: "1.3.6.1.4.1.232.3.2.3.1.1.4",
  logDrv: "1.3.6.1.4.1.232.3.2.3.1.1",
  cntlr: "1.3.6.1.4.1.232.3.2.2.1.1",
  cntlrStatus: "1.3.6.1.4.1.232.3.2.2.1.1.10",
  cntlrLocation: "1.3.6.1.4.1.232.3.2.2.1.1.20",
  accel: "1.3.6.1.4.1.232.3.2.2.2.1",
  accelStatus: "1.3.6.1.4.1.232.3.2.2.2.1.2",
  psu: "1.3.6.1.4.1.232.6.2.9.3.1",
  psuSerial: "1.3.6.1.4.1.232.6.2.9.3.1.11",
  fan: "1.3.6.1.4.1.232.6.2.6.7.1",
  temperature: "1.3.6.1.4.1.232.6.2.6.8.1",
  resMem: "1.3.6.1.4.1.232.6.2.14.11.1",
  resMem2: "1.3.6.1.4.1.232.6.2.14.13.1",
  sysBattery: "1.3.6.1.4.1.232.6.2.17.2.1",
  cpu: "1.3.6.1.4.1.232.1.2.2.1.1",
  cpuStatus: "1.3.6.1.4.1.232.1.2.2.1.1.6",
  cpuName: "1.3.6.1.4.1.232.1.2.2.1.1.3",
};

/** HPE_COL members that are whole table entries rather than single columns. */
const TABLE_ENTRIES: ReadonlySet<string> = new Set([
  HPE_COL.phyDrv,
  HPE_COL.logDrv,
  HPE_COL.cntlr,
  HPE_COL.accel,
  HPE_COL.psu,
  HPE_COL.fan,
  HPE_COL.temperature,
  HPE_COL.resMem,
  HPE_COL.resMem2,
  HPE_COL.sysBattery,
  HPE_COL.cpu,
]);

interface HpeTrap {
  name: string;
  alertType: string;
  /** Severity + state, from the trap alone or from its status varbind. */
  classify: (varbinds: SnmpTrapVarbind[]) => { severity: Severity; state: State };
  component?: (varbinds: SnmpTrapVarbind[]) => string | undefined;
  detail?: (varbinds: SnmpTrapVarbind[]) => string | undefined;
}

const fixed =
  (severity: Severity, state: State = "OPEN") =>
  () => ({ severity, state });

/** A `...StatusChange` trap: recovery when the status varbind reads its ok
 *  value, otherwise the mapped severity (or `fallback` for unlisted values). */
const byStatus =
  (column: string, ok: number, map: Record<number, Severity>, fallback: Severity) =>
  (varbinds: SnmpTrapVarbind[]): { severity: Severity; state: State } => {
    const status = intValue(varbinds, column);
    if (status === ok) {
      return { severity: "INFO", state: "RECOVERED" };
    }
    return {
      severity: (status !== undefined ? map[status] : undefined) ?? fallback,
      state: "OPEN",
    };
  };

const indexed =
  (label: string, ...columns: string[]) =>
  (varbinds: SnmpTrapVarbind[]): string | undefined => {
    const idx = rowIndex(varbinds, ...columns);
    return idx ? `${label}:${idx}` : undefined;
  };

const phyDrvDetail = (varbinds: SnmpTrapVarbind[]) =>
  joinDetail(
    find(varbinds, HPE_COL.phyDrvLocation)?.value,
    find(varbinds, HPE_COL.phyDrvBay)?.value
      ? `bay ${find(varbinds, HPE_COL.phyDrvBay)?.value}`
      : undefined,
    find(varbinds, HPE_COL.phyDrvSerial)?.value
      ? `serial ${find(varbinds, HPE_COL.phyDrvSerial)?.value}`
      : undefined,
  );

/** cpqDaPhyDrvStatus: ok(2), failed(3), predictiveFailure(4), erasing(5),
 *  eraseDone(6), eraseQueued(7), ssdWearOut(8), notAuthenticated(9). */
const PHY_DRV_SEVERITY: Record<number, Severity> = {
  3: "CRITICAL",
  4: "HIGH",
  5: "INFO",
  6: "INFO",
  7: "INFO",
  8: "HIGH",
  9: "WARNING",
};

function hpeFamily(oids: string[], trap: HpeTrap): Array<[string, HpeTrap]> {
  return oids.map((oid) => [oid, trap]);
}

const phyDrvStatusChange: HpeTrap = {
  name: "cpqDaPhyDrvStatusChange",
  alertType: "hardware.drive_fault",
  classify: byStatus(HPE_COL.phyDrvStatus, 2, PHY_DRV_SEVERITY, "WARNING"),
  component: indexed("PhyDrv", HPE_COL.phyDrvStatus, HPE_COL.phyDrv),
  detail: phyDrvDetail,
};

const HPE_TRAPS: ReadonlyMap<string, HpeTrap> = new Map<string, HpeTrap>([
  // Physical drives — every MIB variant (which one iLO sends varies by generation).
  ...hpeFamily(
    [cpq(3046), cpq(3036), cpq(3029), cpq(3018), cpq(3010), cpq(3003), "1.3.6.1.4.1.232.3.0.3"],
    phyDrvStatusChange,
  ),
  ...hpeFamily([cpq(3037), cpq(3030), cpq(3019), cpq(3011), cpq(3004), "1.3.6.1.4.1.232.3.0.4"], {
    name: "cpqDaPhyDrvThreshPassedTrap",
    alertType: "hardware.drive_predictive_failure",
    classify: fixed("HIGH"),
    component: indexed("PhyDrv", HPE_COL.phyDrv),
    detail: phyDrvDetail,
  }),
  [
    cpq(3049),
    {
      name: "cpqDaPhyDrvSSDWearStatusChange",
      alertType: "hardware.drive_ssd_wear",
      // cpqDaPhyDrvSSDWearStatus: ok(2), thresholds (3..5), ssdWearOut(6)
      classify: byStatus(
        HPE_COL.phyDrvSsdWear,
        2,
        { 3: "WARNING", 4: "WARNING", 5: "WARNING", 6: "HIGH" },
        "WARNING",
      ),
      component: indexed("PhyDrv", HPE_COL.phyDrvSsdWear, HPE_COL.phyDrv),
      detail: phyDrvDetail,
    },
  ],
  // Logical drives: ok(2), failed(3), recovering(5) / readyForRebuild(6) / rebuilding(7) ...
  ...hpeFamily([cpq(3034), cpq(3008), cpq(3001), "1.3.6.1.4.1.232.3.0.1"], {
    name: "cpqDaLogDrvStatusChange",
    alertType: "hardware.logical_drive_fault",
    classify: byStatus(HPE_COL.logDrvStatus, 2, { 3: "CRITICAL", 4: "INFO" }, "HIGH"),
    component: indexed("LogDrv", HPE_COL.logDrvStatus, HPE_COL.logDrv),
  }),
  // Array controller: ok(2), generalFailure(3), cableProblem(4), poweredOff(5), cacheModuleMissing(6)
  ...hpeFamily([cpq(3033), cpq(3028), cpq(3015)], {
    name: "cpqDaCntlrStatusChange",
    alertType: "hardware.storage_controller_fault",
    classify: byStatus(HPE_COL.cntlrStatus, 2, { 3: "CRITICAL", 4: "HIGH", 6: "HIGH" }, "WARNING"),
    component: indexed("Cntlr", HPE_COL.cntlrStatus, HPE_COL.cntlr),
    detail: (vbs) => find(vbs, HPE_COL.cntlrLocation)?.value,
  }),
  // Array accelerator (cache module): enabled(3) is healthy; permDisabled(5), cacheModCriticalFailure(8)
  ...hpeFamily([cpq(3038), cpq(3025), cpq(3012), cpq(3005), "1.3.6.1.4.1.232.3.0.5"], {
    name: "cpqDaAccelStatusChange",
    alertType: "hardware.array_cache_fault",
    classify: byStatus(HPE_COL.accelStatus, 3, { 5: "HIGH", 8: "HIGH" }, "WARNING"),
    component: indexed("Accel", HPE_COL.accelStatus, HPE_COL.accel),
  }),
  ...hpeFamily([cpq(3040), cpq(3027), cpq(3014), cpq(3007), "1.3.6.1.4.1.232.3.0.7"], {
    name: "cpqDaAccelBatteryFailed",
    alertType: "hardware.array_cache_battery_fault",
    classify: fixed("HIGH"),
    component: indexed("Accel", HPE_COL.accel),
  }),
  // Fault-tolerant power supplies (component = chassis.bay row index)
  ...hpeFamily([cpq(6050), cpq(6031)], {
    name: "cpqHeFltTolPowerSupplyFailed",
    alertType: "hardware.power_supply_fault",
    classify: fixed("CRITICAL"),
    component: indexed("PSU", HPE_COL.psu),
    detail: (vbs) => find(vbs, HPE_COL.psuSerial)?.value,
  }),
  ...hpeFamily([cpq(6049), cpq(6030), cpq(6069)], {
    name: "cpqHeFltTolPowerSupplyDegraded",
    alertType: "hardware.power_supply_fault",
    classify: fixed("HIGH"),
    component: indexed("PSU", HPE_COL.psu),
    detail: (vbs) => find(vbs, HPE_COL.psuSerial)?.value,
  }),
  [
    cpq(6048),
    {
      name: "cpqHe4FltTolPowerSupplyOk",
      alertType: "hardware.power_supply_fault",
      classify: fixed("INFO", "RECOVERED"),
      component: indexed("PSU", HPE_COL.psu),
    },
  ],
  [
    cpq(6032),
    {
      name: "cpqHe3FltTolPowerRedundancyLost",
      alertType: "hardware.power_redundancy_lost",
      classify: fixed("HIGH"),
    },
  ],
  [
    cpq(6054),
    {
      name: "cpqHe3FltTolPowerRedundancyRestored",
      alertType: "hardware.power_redundancy_lost",
      classify: fixed("INFO", "RECOVERED"),
    },
  ],
  [
    cpq(6034),
    {
      name: "cpqHe3FltTolPowerSupplyRemoved",
      alertType: "hardware.power_supply_removed",
      classify: fixed("WARNING"),
      component: indexed("PSU", HPE_COL.psu),
    },
  ],
  [
    cpq(6033),
    {
      name: "cpqHe3FltTolPowerSupplyInserted",
      alertType: "hardware.power_supply_removed",
      classify: fixed("INFO", "RECOVERED"),
      component: indexed("PSU", HPE_COL.psu),
    },
  ],
  // Fans
  [
    cpq(6036),
    {
      name: "cpqHe3FltTolFanFailed",
      alertType: "hardware.fan_fault",
      classify: fixed("HIGH"),
      component: indexed("Fan", HPE_COL.fan),
    },
  ],
  [
    cpq(6035),
    {
      name: "cpqHe3FltTolFanDegraded",
      alertType: "hardware.fan_fault",
      classify: fixed("WARNING"),
      component: indexed("Fan", HPE_COL.fan),
    },
  ],
  [
    cpq(6037),
    {
      name: "cpqHe3FltTolFanRedundancyLost",
      alertType: "hardware.fan_redundancy_lost",
      classify: fixed("HIGH"),
    },
  ],
  [
    cpq(6055),
    {
      name: "cpqHe3FltTolFanRedundancyRestored",
      alertType: "hardware.fan_redundancy_lost",
      classify: fixed("INFO", "RECOVERED"),
    },
  ],
  [
    cpq(6039),
    {
      name: "cpqHe3FltTolFanRemoved",
      alertType: "hardware.fan_removed",
      classify: fixed("WARNING"),
      component: indexed("Fan", HPE_COL.fan),
    },
  ],
  [
    cpq(6038),
    {
      name: "cpqHe3FltTolFanInserted",
      alertType: "hardware.fan_removed",
      classify: fixed("INFO", "RECOVERED"),
      component: indexed("Fan", HPE_COL.fan),
    },
  ],
  [
    cpq(6020),
    {
      name: "cpqHe3ThermalSystemFanFailed",
      alertType: "hardware.system_fan_fault",
      classify: fixed("HIGH"),
    },
  ],
  [
    cpq(6021),
    {
      name: "cpqHe3ThermalSystemFanDegraded",
      alertType: "hardware.system_fan_fault",
      classify: fixed("WARNING"),
    },
  ],
  [
    cpq(6022),
    {
      name: "cpqHe3ThermalSystemFanOk",
      alertType: "hardware.system_fan_fault",
      classify: fixed("INFO", "RECOVERED"),
    },
  ],
  // Temperature (the cpqHe3Temperature* traps carry the sensor row; the older Thermal* ones don't)
  [
    cpq(6040),
    {
      name: "cpqHe3TemperatureFailed",
      alertType: "hardware.temperature_fault",
      classify: fixed("CRITICAL"),
      component: indexed("Temp", HPE_COL.temperature),
    },
  ],
  [
    cpq(6041),
    {
      name: "cpqHe3TemperatureDegraded",
      alertType: "hardware.temperature_fault",
      classify: fixed("HIGH"),
      component: indexed("Temp", HPE_COL.temperature),
    },
  ],
  [
    cpq(6042),
    {
      name: "cpqHe3TemperatureOk",
      alertType: "hardware.temperature_fault",
      classify: fixed("INFO", "RECOVERED"),
      component: indexed("Temp", HPE_COL.temperature),
    },
  ],
  [
    cpq(6017),
    {
      name: "cpqHe3ThermalTempFailed",
      alertType: "hardware.thermal_fault",
      classify: fixed("CRITICAL"),
    },
  ],
  [
    cpq(6018),
    {
      name: "cpqHe3ThermalTempDegraded",
      alertType: "hardware.thermal_fault",
      classify: fixed("HIGH"),
    },
  ],
  [
    cpq(6019),
    {
      name: "cpqHe3ThermalTempOk",
      alertType: "hardware.thermal_fault",
      classify: fixed("INFO", "RECOVERED"),
    },
  ],
  // Memory
  ...hpeFamily([cpq(6015), "1.3.6.1.4.1.232.6.0.1"], {
    name: "cpqHeCorrectableMemoryError",
    alertType: "hardware.memory_correctable_errors",
    classify: fixed("WARNING"),
  }),
  ...hpeFamily([cpq(6056), cpq(6029)], {
    name: "cpqHeCorrMemReplaceMemModule",
    alertType: "hardware.memory_module_replace",
    classify: fixed("WARNING"),
    component: indexed("DIMM", HPE_COL.resMem, HPE_COL.resMem2),
  }),
  [
    cpq(6064),
    {
      name: "cpqHe5CorrMemReplaceMemModule",
      alertType: "hardware.memory_module_replace",
      classify: fixed("HIGH"),
      component: indexed("DIMM", HPE_COL.resMem2, HPE_COL.resMem),
    },
  ],
  // System (Smart Storage) battery, POST errors, CPU
  [
    cpq(6070),
    {
      name: "cpqHeSysBatteryFailed",
      alertType: "hardware.battery_fault",
      classify: fixed("HIGH"),
      component: indexed("Battery", HPE_COL.sysBattery),
    },
  ],
  [
    cpq(6071),
    {
      name: "cpqHeSysBatteryRemoved",
      alertType: "hardware.battery_fault",
      classify: fixed("WARNING"),
      component: indexed("Battery", HPE_COL.sysBattery),
    },
  ],
  [
    cpq(6027),
    { name: "cpqHe3PostError", alertType: "hardware.post_error", classify: fixed("WARNING") },
  ],
  [
    cpq(1006),
    {
      name: "cpqSeCpuStatusChange",
      alertType: "hardware.processor_fault",
      // cpqSeCpuStatus: ok(2), degraded(3), failed(4), disabled(5)
      classify: byStatus(HPE_COL.cpuStatus, 2, { 3: "HIGH", 4: "CRITICAL" }, "WARNING"),
      component: indexed("CPU", HPE_COL.cpuStatus, HPE_COL.cpu),
      detail: (vbs) => find(vbs, HPE_COL.cpuName)?.value,
    },
  ],
]);

/**
 * Recognise a Dell iDRAC or HPE hardware trap by its OID. Returns undefined
 * for anything else (the generic SNMP handling applies then).
 */
export function classifyVendorTrap(
  trapOid: string,
  varbinds: SnmpTrapVarbind[],
): VendorTrapClassification | undefined {
  const idrac = IDRAC_TRAPS.get(trapOid);
  if (idrac) {
    return classifyIdrac(idrac, varbinds);
  }
  const hpe = HPE_TRAPS.get(trapOid);
  if (hpe) {
    const { severity, state } = hpe.classify(varbinds);
    return {
      vendor: "HPE",
      trapName: hpe.name,
      alertType: hpe.alertType,
      severity,
      state,
      componentKey: hpe.component?.(varbinds),
      detail: hpe.detail?.(varbinds),
    };
  }
  return undefined;
}
