import type { NormalizedAlertPayload } from "@cts-dc-opsdesk/shared-types";

/**
 * A single varbind (OID → value) from a trap PDU. The site collector's trap
 * receiver has already decoded the PDU; `name` is set when it resolved the OID
 * against a loaded MIB.
 */
export interface SnmpTrapVarbind {
  /** Numeric dotted OID, e.g. "1.3.6.1.2.1.2.2.1.1.3". */
  oid: string;
  /** Textual name if resolved, e.g. "ifIndex", "ifName". */
  name?: string;
  value: string | number | boolean | null;
  /** SNMP syntax hint: "OctetString" | "Integer" | "Gauge32" | "TimeTicks" | "OID" | "IpAddress" | … */
  type?: string;
}

/**
 * A parsed SNMP trap / inform handed to {@link normalizeSnmpTrap}. The trap PDU
 * carries no OpsDesk identifiers, so the collector MUST resolve the source
 * address to a CI (and ideally a site) before calling — same as the Redfish
 * bundle carrying `ciCode`.
 */
export interface SnmpTrap {
  /** OpsDesk CI code the collector resolved from the agent address. Required. */
  ciCode: string;
  /** OpsDesk site code; if omitted, derived from a `SITE01-…` prefix on `ciCode`. */
  siteCode?: string;

  /** `snmpTrapOID.0` value — numeric dotted OID identifying the trap. For a raw
   *  SNMPv1 trap this may be absent; it is then synthesised from `v1` per RFC 3584. */
  trapOid?: string;
  /** Textual trap name if the collector resolved it, e.g. "linkDown". */
  trapName?: string;

  /** Source device address (SNMPv1 agent-addr, or transport source for v2c/v3). */
  agentAddress: string;
  /** `sysUpTime.0` in hundredths of a second, when present in the PDU. */
  sysUpTimeTicks?: number;
  /** Wall-clock time the collector received the trap (ISO-8601). Defaults to now. */
  receivedAt?: string;
  /** "v1" | "v2c" | "v3". */
  version?: string;

  /** Raw SNMPv1 trap fields, used to synthesise `trapOid` when it is absent. */
  v1?: {
    enterprise?: string;
    /** 0 coldStart, 1 warmStart, 2 linkDown, 3 linkUp, 4 authFailure, 5 egpNeighborLoss, 6 enterpriseSpecific. */
    genericTrap?: number;
    specificTrap?: number;
  };

  varbinds?: SnmpTrapVarbind[];

  /** Collector override (from MIB knowledge): forces the normalized severity. */
  severity?: NormalizedAlertPayload["severity"];
  /** Collector override: this is a vendor "clear" / recovery trap → state RECOVERED. */
  clears?: boolean;
}
