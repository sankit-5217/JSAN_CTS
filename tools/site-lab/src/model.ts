/**
 * The simulated site: a Dell (iDRAC) and an HPE (iLO) server, each with drives,
 * power supplies and fans whose health the control panel can change. The
 * Redfish servers render this state on every GET and the trap sender emits the
 * matching vendor trap on every change, so the real collector sees a fault
 * through both channels exactly as it would on real hardware.
 *
 * Local development only — never deploy (see README).
 */

export type Health = "OK" | "Warning" | "Critical";
export type ComponentKind = "drive" | "psu" | "fan";
export type Vendor = "DELL" | "HPE";

export interface SimComponent {
  /** Stable id used by the control panel API. */
  id: string;
  kind: ComponentKind;
  /** Redfish `Name`. */
  name: string;
  health: Health;
  /** Drives only: SMART predicted failure (Redfish `FailurePredicted`). */
  predictive: boolean;
  /** Dell: the iDRAC FQDD the trap carries in alertFQDD. */
  fqdd?: string;
  /** HPE: the table-row index the trap varbinds are suffixed with (e.g. "0.2"). */
  rowIndex?: string;
  serial: string;
}

export interface SimServer {
  id: string;
  vendor: Vendor;
  /** OpsDesk CI code this BMC stands in for (mapped in the collector config). */
  ciCode: string;
  /** HTTPS port the BMC's Redfish service listens on (127.0.0.1). */
  port: number;
  /** Loopback address the server's SNMP traps are sent from, so the collector
   *  can map source address -> CI exactly as it does for a real BMC. */
  trapSource: string;
  systemId: string;
  manufacturer: string;
  model: string;
  serviceTag: string;
  components: SimComponent[];
  /** Last time anything (the collector) read this BMC's Redfish tree. */
  lastPolledAt: string | null;
}

export interface SiteLabEvent {
  at: string;
  server: string;
  message: string;
}

function dellServer(ciCode: string, port: number, trapSource: string): SimServer {
  const ctl = "RAID.Integrated.1-1";
  const drives: SimComponent[] = [0, 1, 2, 3].map((bay) => ({
    id: `disk-${bay}`,
    kind: "drive",
    name: `Physical Disk 0:1:${bay}`,
    health: "OK",
    predictive: false,
    fqdd: `Disk.Bay.${bay}:Enclosure.Internal.0-1:${ctl}`,
    serial: `S4EVNX0R${600 + bay}`,
  }));
  const psus: SimComponent[] = [1, 2].map((slot) => ({
    id: `psu-${slot}`,
    kind: "psu",
    name: `PS${slot} Status`,
    health: "OK",
    predictive: false,
    fqdd: `PSU.Slot.${slot}`,
    serial: `CNDED0098L${slot}`,
  }));
  const fans: SimComponent[] = ["1A", "2A", "3A", "4A"].map((f) => ({
    id: `fan-${f.toLowerCase()}`,
    kind: "fan",
    name: `System Board Fan${f}`,
    health: "OK",
    predictive: false,
    fqdd: `Fan.Embedded.${f}`,
    serial: "",
  }));
  return {
    id: "idrac",
    vendor: "DELL",
    ciCode,
    port,
    trapSource,
    systemId: "System.Embedded.1",
    manufacturer: "Dell Inc.",
    model: "PowerEdge R750",
    serviceTag: "7XK2Q93",
    components: [...drives, ...psus, ...fans],
    lastPolledAt: null,
  };
}

function hpeServer(ciCode: string, port: number, trapSource: string): SimServer {
  const drives: SimComponent[] = [1, 2, 3, 4].map((bay) => ({
    id: `disk-${bay}`,
    kind: "drive",
    name: `Port 1I Box 1 Bay ${bay}`,
    health: "OK",
    predictive: false,
    rowIndex: `0.${bay}`,
    serial: `WFK0ABC${bay}`,
  }));
  const psus: SimComponent[] = [1, 2].map((bay) => ({
    id: `psu-${bay}`,
    kind: "psu",
    name: `HpeServerPowerSupply ${bay}`,
    health: "OK",
    predictive: false,
    rowIndex: `0.${bay}`,
    serial: `5WBXT0B4DAP${bay}`,
  }));
  const fans: SimComponent[] = [1, 2, 3, 4].map((idx) => ({
    id: `fan-${idx}`,
    kind: "fan",
    name: `Fan ${idx}`,
    health: "OK",
    predictive: false,
    rowIndex: `0.${idx}`,
    serial: "",
  }));
  return {
    id: "ilo",
    vendor: "HPE",
    ciCode,
    port,
    trapSource,
    systemId: "1",
    manufacturer: "HPE",
    model: "ProLiant DL380 Gen10 Plus",
    serviceTag: "CZJ2140G7K",
    components: [...drives, ...psus, ...fans],
    lastPolledAt: null,
  };
}

export interface SiteLabTopology {
  dell: { ciCode: string; port: number; trapSource: string };
  hpe: { ciCode: string; port: number; trapSource: string };
}

export function createSite(topology: SiteLabTopology): SimServer[] {
  return [
    dellServer(topology.dell.ciCode, topology.dell.port, topology.dell.trapSource),
    hpeServer(topology.hpe.ciCode, topology.hpe.port, topology.hpe.trapSource),
  ];
}

const RANK: Record<Health, number> = { OK: 0, Warning: 1, Critical: 2 };

/** Effective Redfish health of a component: a predicted drive failure reads
 *  Warning even while the drive itself still reports OK. */
export function effectiveHealth(c: SimComponent): Health {
  return c.predictive && c.health === "OK" ? "Warning" : c.health;
}

/** Worst health across a set of components (the BMC's rollup). */
export function rollup(components: SimComponent[]): Health {
  let worst: Health = "OK";
  for (const c of components) {
    const h = effectiveHealth(c);
    if (RANK[h] > RANK[worst]) {
      worst = h;
    }
  }
  return worst;
}

export function isHealth(value: unknown): value is Health {
  return value === "OK" || value === "Warning" || value === "Critical";
}
