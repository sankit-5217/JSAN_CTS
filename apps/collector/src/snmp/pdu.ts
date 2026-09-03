import type { SnmpTrap, SnmpTrapVarbind } from "@cts-dc-opsdesk/snmp-adapter";

/**
 * Pure mapping from a decoded SNMP trap PDU (as produced by an SNMP library's
 * trap receiver) to the `SnmpTrap` shape the `snmp-adapter` normalizes. No I/O,
 * no MIB resolution — that stays in the adapter / a future MIB layer.
 */

/** A varbind straight off the wire. `value` may be a Buffer for OctetString. */
export interface RawVarbind {
  oid: string;
  /** library type tag, e.g. "OctetString" | "Integer" | "TimeTicks" | "OID". */
  type?: string;
  value: string | number | boolean | Buffer | null;
}

/** SNMPv2c / v3 notification PDU. varbinds[0] = sysUpTime.0, [1] = snmpTrapOID.0. */
export interface V2cNotificationPdu {
  version: "v2c" | "v3";
  varbinds: RawVarbind[];
}

/** Raw SNMPv1 trap PDU. */
export interface V1TrapPdu {
  version: "v1";
  enterprise?: string;
  genericTrap?: number;
  specificTrap?: number;
  /** device uptime, hundredths of a second. */
  upTime?: number;
  varbinds: RawVarbind[];
}

export type DecodedTrapPdu = V2cNotificationPdu | V1TrapPdu;

export interface TrapSource {
  /** Transport source address the trap arrived from. */
  address: string;
  /** OpsDesk CI code the collector resolved for this address, if known. */
  ciCode?: string;
}

const SYS_UPTIME_OID = "1.3.6.1.2.1.1.3.0";
const SNMP_TRAP_OID = "1.3.6.1.6.3.1.1.4.1.0";

function scalar(value: RawVarbind["value"]): string | number | boolean | null {
  return Buffer.isBuffer(value) ? value.toString("utf8") : value;
}

function toVarbind(v: RawVarbind): SnmpTrapVarbind {
  return { oid: v.oid, value: scalar(v.value), ...(v.type ? { type: v.type } : {}) };
}

/**
 * Convert a decoded PDU + its transport source into a `SnmpTrap`. `receivedAt`
 * defaults to now. When the source address is unknown, `ciCode` is left blank —
 * the adapter / API then rejects the trap, which surfaces in the collector log
 * rather than being silently dropped.
 */
export function pduToSnmpTrap(
  pdu: DecodedTrapPdu,
  source: TrapSource,
  receivedAt: string = new Date().toISOString(),
): SnmpTrap {
  const base = {
    ciCode: source.ciCode ?? "",
    agentAddress: source.address,
    receivedAt,
  };

  if (pdu.version === "v1") {
    return {
      ...base,
      version: "v1",
      v1: {
        ...(pdu.enterprise ? { enterprise: pdu.enterprise } : {}),
        ...(pdu.genericTrap !== undefined ? { genericTrap: pdu.genericTrap } : {}),
        ...(pdu.specificTrap !== undefined ? { specificTrap: pdu.specificTrap } : {}),
      },
      ...(pdu.upTime !== undefined ? { sysUpTimeTicks: pdu.upTime } : {}),
      varbinds: pdu.varbinds.map(toVarbind),
    };
  }

  let sysUpTimeTicks: number | undefined;
  let trapOid: string | undefined;
  const data: SnmpTrapVarbind[] = [];

  for (const vb of pdu.varbinds) {
    if (vb.oid === SYS_UPTIME_OID) {
      const n = Number(scalar(vb.value));
      if (Number.isFinite(n)) {
        sysUpTimeTicks = n;
      }
      continue;
    }
    if (vb.oid === SNMP_TRAP_OID) {
      const s = scalar(vb.value);
      if (typeof s === "string" && s) {
        trapOid = s;
      }
      continue;
    }
    data.push(toVarbind(vb));
  }

  return {
    ...base,
    version: pdu.version,
    ...(trapOid ? { trapOid } : {}),
    ...(sysUpTimeTicks !== undefined ? { sysUpTimeTicks } : {}),
    varbinds: data,
  };
}
