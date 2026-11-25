import * as snmp from "net-snmp";
import { effectiveHealth, type SimComponent, type SimServer } from "./model";

/**
 * The trap a real BMC sends when a component changes state. OIDs and varbind
 * layouts are the ones from IDRAC-MIB-SMIv2 / CPQIDA-MIB / CPQHLTH-MIB that the
 * SNMP adapter recognises (integrations/snmp/src/vendor-traps.ts), so the
 * collector -> API path is exercised with byte-for-byte realistic traps.
 */

export interface TrapVarbind {
  oid: string;
  type: "OctetString" | "Integer";
  value: string | number;
}

export interface TrapSpec {
  oid: string;
  name: string;
  varbinds: TrapVarbind[];
}

const IDRAC_VB = "1.3.6.1.4.1.674.10892.5.3.1";
const IDRAC_SYS = "1.3.6.1.4.1.674.10892.5.3.2.1.0";
const IDRAC_STORAGE = "1.3.6.1.4.1.674.10892.5.3.2.2.0";
/** IDRAC ObjectStatusEnum: ok(3), nonCritical(4), critical(5). */
const IDRAC_STATUS = { OK: 3, Warning: 4, Critical: 5 } as const;

function dellTrap(server: SimServer, c: SimComponent): TrapSpec {
  const h = effectiveHealth(c);
  // [failure, warning, ok/information] trap numbers per component family
  const family = {
    drive: {
      base: IDRAC_STORAGE,
      nums: [4345, 4346, 4347],
      stem: "alertStoragePhysicalDisk",
      ok: "Information",
      code: "PDR",
    },
    psu: {
      base: IDRAC_SYS,
      nums: [2185, 2186, 2187],
      stem: "alertPowerSupply",
      ok: "Normal",
      code: "PSU",
    },
    fan: {
      base: IDRAC_SYS,
      nums: [2153, 2154, 2155],
      stem: "alertFan",
      ok: "Information",
      code: "FAN",
    },
  }[c.kind];
  const idx = h === "Critical" ? 0 : h === "Warning" ? 1 : 2;
  const suffix = ["Failure", "Warning", family.ok][idx];
  const message =
    h === "Critical"
      ? `${c.name} has failed.`
      : c.predictive
        ? `Predictive failure reported for ${c.name}.`
        : h === "Warning"
          ? `${c.name} is in a warning state.`
          : `${c.name} is operating normally.`;
  const messageId = `${family.code}${h === "Critical" ? "1016" : h === "Warning" ? "16" : "1"}`;
  return {
    oid: `${family.base}.${family.nums[idx]}`,
    name: `${family.stem}${suffix}`,
    varbinds: [
      { oid: `${IDRAC_VB}.1.0`, type: "OctetString", value: messageId },
      { oid: `${IDRAC_VB}.2.0`, type: "OctetString", value: message },
      { oid: `${IDRAC_VB}.3.0`, type: "Integer", value: IDRAC_STATUS[h] },
      { oid: `${IDRAC_VB}.4.0`, type: "OctetString", value: server.serviceTag },
      {
        oid: `${IDRAC_VB}.5.0`,
        type: "OctetString",
        value: `${server.ciCode.toLowerCase()}.site.local`,
      },
      { oid: `${IDRAC_VB}.6.0`, type: "OctetString", value: c.fqdd as string },
      { oid: `${IDRAC_VB}.7.0`, type: "OctetString", value: c.name },
    ],
  };
}

const cpq = (n: number) => `1.3.6.1.4.1.232.0.${n}`;

function hpeTrap(c: SimComponent): TrapSpec | undefined {
  const h = effectiveHealth(c);
  const row = c.rowIndex as string;
  if (c.kind === "drive") {
    // cpqDaPhyDrvStatus: ok(2), failed(3), predictiveFailure(4)
    const value = c.health === "Critical" ? 3 : c.predictive || c.health === "Warning" ? 4 : 2;
    return {
      oid: cpq(3046),
      name: "cpqDa7PhyDrvStatusChange",
      varbinds: [
        { oid: `1.3.6.1.4.1.232.3.2.5.1.1.64.${row}`, type: "OctetString", value: c.name },
        { oid: `1.3.6.1.4.1.232.3.2.5.1.1.51.${row}`, type: "OctetString", value: c.serial },
        { oid: `1.3.6.1.4.1.232.3.2.5.1.1.6.${row}`, type: "Integer", value },
      ],
    };
  }
  if (c.kind === "psu") {
    const [num, name] =
      h === "Critical"
        ? [6050, "cpqHe4FltTolPowerSupplyFailed"]
        : h === "Warning"
          ? [6049, "cpqHe4FltTolPowerSupplyDegraded"]
          : [6048, "cpqHe4FltTolPowerSupplyOk"];
    const [chassis, bay] = row.split(".");
    return {
      oid: cpq(num),
      name,
      varbinds: [
        { oid: `1.3.6.1.4.1.232.6.2.9.3.1.1.${row}`, type: "Integer", value: Number(chassis) },
        { oid: `1.3.6.1.4.1.232.6.2.9.3.1.2.${row}`, type: "Integer", value: Number(bay) },
        { oid: `1.3.6.1.4.1.232.6.2.9.3.1.11.${row}`, type: "OctetString", value: c.serial },
      ],
    };
  }
  // Fans: HPE has failed / degraded traps but no per-fan "ok" trap — recovery
  // only shows up through Redfish polling, exactly like the real hardware.
  if (h === "OK") {
    return undefined;
  }
  const [chassis, idx] = row.split(".");
  return {
    oid: cpq(h === "Critical" ? 6036 : 6035),
    name: h === "Critical" ? "cpqHe3FltTolFanFailed" : "cpqHe3FltTolFanDegraded",
    varbinds: [
      { oid: `1.3.6.1.4.1.232.6.2.6.7.1.1.${row}`, type: "Integer", value: Number(chassis) },
      { oid: `1.3.6.1.4.1.232.6.2.6.7.1.2.${row}`, type: "Integer", value: Number(idx) },
    ],
  };
}

/** The trap this server sends for a component's current state, or undefined
 *  when the real device sends none (HPE fan recovery). */
export function trapFor(server: SimServer, c: SimComponent): TrapSpec | undefined {
  return server.vendor === "DELL" ? dellTrap(server, c) : hpeTrap(c);
}

/** Sends real SNMPv2c trap datagrams from each server's own loopback address. */
export class TrapSender {
  constructor(private readonly target: { host: string; port: number; community: string }) {}

  send(server: SimServer, spec: TrapSpec): Promise<void> {
    const session = snmp.createSession(this.target.host, this.target.community, {
      port: this.target.port,
      trapPort: this.target.port,
      version: snmp.Version2c,
      sourceAddress: server.trapSource,
    } as snmp.SessionOptions);
    const varbinds = spec.varbinds.map((vb) => ({
      oid: vb.oid,
      type: vb.type === "Integer" ? snmp.ObjectType.Integer : snmp.ObjectType.OctetString,
      value: vb.value,
    }));
    return new Promise((resolve, reject) => {
      session.trap(spec.oid, varbinds, (err: Error | null) => {
        session.close();
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }
}
