/**
 * Collector configuration. One collector serves exactly one site (ADR-004:
 * "runs at each site"). It never holds central user credentials — only a scoped
 * machine token for the OpsDesk API, plus per-endpoint credentials from a local
 * secret store (referenced here by name, resolved elsewhere).
 */

export type EndpointKind = "REDFISH" | "DELL_OME" | "HPE_ILO";

export interface EndpointTarget {
  /** OpsDesk CI code this endpoint maps to. */
  ciCode: string;
  kind: EndpointKind;
  /**
   * REDFISH / HPE_ILO: base URL of the BMC, e.g. "https://10.20.1.40".
   * DELL_OME: base URL of the OME appliance (one appliance serves many devices).
   * LAN only.
   */
  address: string;
  /** Name of the credential in the local secret store (not the secret itself). */
  credentialRef: string;
  /**
   * DELL_OME only, required: the managed device's Service Tag — OME manages a
   * fleet, so one CI is one device on the appliance. Ignored for REDFISH/HPE_ILO.
   */
  deviceRef?: string;
}

/** An SNMP trap source — maps a device's source IP to its OpsDesk CI code. */
export interface SnmpSource {
  /** Source address traps arrive from (SNMPv1 agent-addr / v2c transport source). */
  address: string;
  ciCode: string;
}

export interface CollectorConfig {
  /** The one site this collector reports for. */
  siteCode: string;
  /** Central OpsDesk API base, e.g. "https://opsdesk.jsan.example/api/v1". Outbound HTTPS only. */
  apiBaseUrl: string;
  /** Scoped service-account JWT for the OpsDesk API. */
  apiToken: string;
  /** Seconds between health polls of every endpoint. */
  pollIntervalSeconds: number;
  /** Seconds between collector heartbeats to the API (spec §26). */
  heartbeatIntervalSeconds: number;
  /** How many undelivered events to buffer locally before dropping the oldest. */
  bufferMaxItems: number;
  endpoints: EndpointTarget[];
  /** UDP port the trap listener binds (default 162). */
  snmpTrapPort: number;
  /** Known trap sources; a trap from an address not listed here is delivered with
   *  no ciCode and the API rejects it (visible in the collector log). */
  snmpSources: SnmpSource[];
}

export class CollectorConfigError extends Error {
  constructor(
    message: string,
    readonly field: string,
  ) {
    super(message);
    this.name = "CollectorConfigError";
  }
}

const KINDS: readonly EndpointKind[] = ["REDFISH", "DELL_OME", "HPE_ILO"];

function str(raw: Record<string, unknown>, key: string): string {
  const v = raw[key];
  if (typeof v !== "string" || v.trim() === "") {
    throw new CollectorConfigError(`"${key}" must be a non-empty string`, key);
  }
  return v.trim();
}

function posInt(raw: Record<string, unknown>, key: string, fallback: number): number {
  const v = raw[key];
  if (v === undefined) {
    return fallback;
  }
  if (typeof v !== "number" || !Number.isInteger(v) || v <= 0) {
    throw new CollectorConfigError(`"${key}" must be a positive integer`, key);
  }
  return v;
}

function requireHttps(url: string, field: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new CollectorConfigError(`"${field}" is not a valid URL: ${url}`, field);
  }
  if (parsed.protocol !== "https:") {
    throw new CollectorConfigError(`"${field}" must be https (outbound TLS only, ADR-004)`, field);
  }
  return url;
}

/** Parse + validate a raw config object (e.g. from JSON / env). Throws {@link CollectorConfigError}. */
export function loadConfig(raw: unknown): CollectorConfig {
  if (typeof raw !== "object" || raw === null) {
    throw new CollectorConfigError("config must be an object", "(root)");
  }
  const r = raw as Record<string, unknown>;

  const endpointsRaw = r.endpoints;
  if (!Array.isArray(endpointsRaw) || endpointsRaw.length === 0) {
    throw new CollectorConfigError('"endpoints" must be a non-empty array', "endpoints");
  }

  const endpoints: EndpointTarget[] = endpointsRaw.map((e, i) => {
    if (typeof e !== "object" || e === null) {
      throw new CollectorConfigError(`endpoints[${i}] must be an object`, `endpoints[${i}]`);
    }
    const er = e as Record<string, unknown>;
    const kind = str(er, "kind") as EndpointKind;
    if (!KINDS.includes(kind)) {
      throw new CollectorConfigError(
        `endpoints[${i}].kind must be one of ${KINDS.join(", ")}`,
        `endpoints[${i}].kind`,
      );
    }
    const target: EndpointTarget = {
      ciCode: str(er, "ciCode"),
      kind,
      address: str(er, "address"),
      credentialRef: str(er, "credentialRef"),
    };
    if (kind === "DELL_OME") {
      target.deviceRef = str(er, "deviceRef");
    } else if (typeof er.deviceRef === "string") {
      target.deviceRef = er.deviceRef.trim();
    }
    return target;
  });

  const snmpSourcesRaw = r.snmpSources ?? [];
  if (!Array.isArray(snmpSourcesRaw)) {
    throw new CollectorConfigError('"snmpSources" must be an array', "snmpSources");
  }
  const snmpSources: SnmpSource[] = snmpSourcesRaw.map((s, i) => {
    if (typeof s !== "object" || s === null) {
      throw new CollectorConfigError(`snmpSources[${i}] must be an object`, `snmpSources[${i}]`);
    }
    const sr = s as Record<string, unknown>;
    return { address: str(sr, "address"), ciCode: str(sr, "ciCode") };
  });

  return {
    siteCode: str(r, "siteCode"),
    apiBaseUrl: requireHttps(str(r, "apiBaseUrl"), "apiBaseUrl"),
    apiToken: str(r, "apiToken"),
    pollIntervalSeconds: posInt(r, "pollIntervalSeconds", 300),
    heartbeatIntervalSeconds: posInt(r, "heartbeatIntervalSeconds", 60),
    bufferMaxItems: posInt(r, "bufferMaxItems", 10_000),
    endpoints,
    snmpTrapPort: posInt(r, "snmpTrapPort", 162),
    snmpSources,
  };
}
