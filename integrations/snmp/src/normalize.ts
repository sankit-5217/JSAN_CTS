import type { NormalizedAlertPayload } from "@cts-dc-opsdesk/shared-types";
import type { SnmpTrap, SnmpTrapVarbind } from "./types";

/** Thrown when an SNMP trap cannot be mapped onto the OpsDesk alert contract. */
export class SnmpNormalizationError extends Error {
  constructor(
    message: string,
    readonly field: string,
  ) {
    super(message);
    this.name = "SnmpNormalizationError";
  }
}

type Severity = NormalizedAlertPayload["severity"];
type State = NormalizedAlertPayload["state"];

interface KnownTrap {
  alertType: string;
  severity: Severity;
  state: State;
  /** hint for component extraction. */
  component?: "interface";
}

/** Standard SNMPv2-MIB / IF-MIB trap OIDs. linkDown and linkUp deliberately
 *  share an `alertType` + component so the alerts pipeline pairs them by
 *  fingerprint (site + CI + alertType + component). */
const KNOWN_TRAPS: Record<string, KnownTrap> = {
  "1.3.6.1.6.3.1.1.5.1": { alertType: "device.cold_start", severity: "WARNING", state: "OPEN" },
  "1.3.6.1.6.3.1.1.5.2": { alertType: "device.warm_start", severity: "INFO", state: "OPEN" },
  "1.3.6.1.6.3.1.1.5.3": {
    alertType: "network.link_state",
    severity: "HIGH",
    state: "OPEN",
    component: "interface",
  },
  "1.3.6.1.6.3.1.1.5.4": {
    alertType: "network.link_state",
    severity: "INFO",
    state: "RECOVERED",
    component: "interface",
  },
  "1.3.6.1.6.3.1.1.5.5": {
    alertType: "security.authentication_failure",
    severity: "WARNING",
    state: "OPEN",
  },
  "1.3.6.1.6.3.1.1.5.6": {
    alertType: "network.egp_neighbor_loss",
    severity: "HIGH",
    state: "OPEN",
  },
};

/** RFC 3584: SNMPv1 generic-trap 0..5 map to these standard trap OIDs. */
const V1_GENERIC_OIDS = [
  "1.3.6.1.6.3.1.1.5.1",
  "1.3.6.1.6.3.1.1.5.2",
  "1.3.6.1.6.3.1.1.5.3",
  "1.3.6.1.6.3.1.1.5.4",
  "1.3.6.1.6.3.1.1.5.5",
  "1.3.6.1.6.3.1.1.5.6",
];

const IF_NAME_OIDS = ["1.3.6.1.2.1.31.1.1.1.1", "1.3.6.1.2.1.2.2.1.2"]; // ifName, ifDescr
const IF_INDEX_OID = "1.3.6.1.2.1.2.2.1.1";

function slug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function required(value: string | undefined, field: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new SnmpNormalizationError(`SNMP trap is missing required field "${field}"`, field);
  }
  return trimmed;
}

/** Best-effort site code from a `SITE01-...` style CI code. */
function siteFromCi(ciCode: string): string | undefined {
  return ciCode.match(/^([A-Za-z0-9]+?)[-_]/)?.[1];
}

/** Resolve the trap OID, synthesising it from raw SNMPv1 fields when absent. */
function resolveTrapOid(trap: SnmpTrap): string {
  const direct = trap.trapOid?.trim();
  if (direct) {
    return direct;
  }
  const v1 = trap.v1;
  if (v1 && typeof v1.genericTrap === "number") {
    if (v1.genericTrap >= 0 && v1.genericTrap <= 5) {
      return V1_GENERIC_OIDS[v1.genericTrap];
    }
    if (v1.genericTrap === 6 && v1.enterprise?.trim()) {
      return `${v1.enterprise.trim()}.0.${v1.specificTrap ?? 0}`;
    }
  }
  throw new SnmpNormalizationError(
    "SNMP trap has no trapOid and no usable SNMPv1 generic-trap",
    "trapOid",
  );
}

function varbindLabel(vb: SnmpTrapVarbind): string {
  return vb.name?.trim() || vb.oid;
}

function extractComponentKey(
  varbinds: SnmpTrapVarbind[],
  hint: KnownTrap["component"],
): string | undefined {
  if (hint === "interface") {
    const named = varbinds.find(
      (vb) =>
        /^if(name|descr)$/i.test(vb.name ?? "") ||
        IF_NAME_OIDS.some((oid) => vb.oid?.startsWith(oid)),
    );
    if (named?.value != null && String(named.value).trim()) {
      return `if:${String(named.value).trim()}`;
    }
    const indexed = varbinds.find(
      (vb) => /^ifindex$/i.test(vb.name ?? "") || vb.oid?.startsWith(IF_INDEX_OID),
    );
    if (indexed?.value != null) {
      return `ifIndex:${String(indexed.value).trim()}`;
    }
  }
  const generic = varbinds.find((vb) =>
    /^(component|entity|entphysicalname|slot|sensor|unit)$/i.test(vb.name ?? ""),
  );
  return generic?.value != null && String(generic.value).trim()
    ? String(generic.value).trim()
    : undefined;
}

function genericAlertType(trap: SnmpTrap, trapOid: string): string {
  if (trap.trapName?.trim()) {
    return `snmp.${slug(trap.trapName)}`;
  }
  const arcs = trapOid.split(".").filter(Boolean);
  return `snmp.trap_${arcs.slice(-2).join("_")}`;
}

function varbindMap(varbinds: SnmpTrapVarbind[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const vb of varbinds) {
    out[varbindLabel(vb)] = vb.value;
  }
  return out;
}

/**
 * Normalize one parsed SNMP trap into the OpsDesk alert contract. Pure and
 * deterministic — no I/O, no MIB loading. Recognises the standard SNMPv2-MIB
 * traps and synthesises the OID for a raw SNMPv1 trap (RFC 3584); every other
 * trap becomes `snmp.<trapName|last OID arcs>` at `WARNING` unless the collector
 * supplied `severity` / `clears`. Throws {@link SnmpNormalizationError} when a
 * required field is absent; the caller decides drop vs dead-letter.
 *
 * `eventId` is occurrence-unique (retransmits of the same trap dedupe);
 * pairing a fault trap with its later "clear" is the alerts pipeline's job,
 * done by fingerprint — hence linkDown / linkUp share `alertType` + component.
 */
export function normalizeSnmpTrap(trap: SnmpTrap): NormalizedAlertPayload {
  const ciCode = required(trap.ciCode, "ciCode");
  const siteCode = trap.siteCode?.trim() || siteFromCi(ciCode);
  if (!siteCode) {
    throw new SnmpNormalizationError(
      `SNMP trap for CI "${ciCode}" has no siteCode and no site prefix on the CI code`,
      "siteCode",
    );
  }
  const agentAddress = required(trap.agentAddress, "agentAddress");

  let occurredAt: string;
  if (trap.receivedAt?.trim()) {
    const parsed = Date.parse(trap.receivedAt.trim());
    if (Number.isNaN(parsed)) {
      throw new SnmpNormalizationError(
        `SNMP trap has an unparseable receivedAt "${trap.receivedAt}"`,
        "receivedAt",
      );
    }
    occurredAt = new Date(parsed).toISOString();
  } else {
    occurredAt = new Date().toISOString();
  }

  const trapOid = resolveTrapOid(trap);
  const known = KNOWN_TRAPS[trapOid];
  const varbinds = trap.varbinds ?? [];

  const componentKey = extractComponentKey(varbinds, known?.component);
  const alertType = known?.alertType ?? genericAlertType(trap, trapOid);
  const severity: Severity = trap.severity ?? known?.severity ?? "WARNING";
  const state: State = trap.clears ? "RECOVERED" : (known?.state ?? "OPEN");

  const occurrenceKey =
    trap.sysUpTimeTicks != null ? String(trap.sysUpTimeTicks) : String(Date.parse(occurredAt));
  const eventId = `snmp-${slug(ciCode)}-${slug(alertType)}-${slug(componentKey ?? "device")}-${occurrenceKey}`;

  const label = trap.trapName?.trim() || known?.alertType || `SNMP trap ${trapOid}`;
  const summary = [label, componentKey ? `on ${componentKey}` : "", `from ${agentAddress}`]
    .filter(Boolean)
    .join(" ");

  return {
    eventId,
    source: "SNMP",
    siteCode,
    ciCode,
    alertType,
    severity,
    componentKey,
    occurredAt,
    state,
    summary,
    attributes: {
      trapOid,
      trapName: trap.trapName,
      snmpVersion: trap.version,
      agentAddress,
      sysUpTimeTicks: trap.sysUpTimeTicks,
      v1: trap.v1,
      varbinds: varbindMap(varbinds),
    },
  };
}
