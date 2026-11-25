import { normalizeHpeIloSystem } from "@cts-dc-opsdesk/hpe-ilo-adapter";
import { normalizeRedfishSystem, type RedfishSystemBundle } from "@cts-dc-opsdesk/redfish-adapter";
import { classifyVendorTrap, normalizeSnmpTrap } from "@cts-dc-opsdesk/snmp-adapter";
import { createSite, rollup, type SimServer } from "./model";
import { resourceFor } from "./redfish";
import { trapFor } from "./traps";

const site = () =>
  createSite({
    dell: { ciCode: "SITE01-R01-SRV-001", port: 8601, trapSource: "127.0.0.11" },
    hpe: { ciCode: "SITE01-R01-DB-001", port: 8602, trapSource: "127.0.0.12" },
  });

/** Walk the simulated tree the way apps/collector/src/hw/redfish-fetcher.ts does. */
function bundle(server: SimServer): RedfishSystemBundle {
  const get = (p: string) => {
    const r = resourceFor(server, p);
    if (!r) throw new Error(`404 ${p}`);
    return r as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  const sysPath = get("/redfish/v1/Systems").Members[0]["@odata.id"];
  const system = get(sysPath);
  const chassis = get("/redfish/v1/Chassis").Members[0]["@odata.id"];
  const drives = get(system.Storage["@odata.id"])
    .Members.flatMap((m: { "@odata.id": string }) => get(m["@odata.id"]).Drives)
    .map((d: { "@odata.id": string }) => get(d["@odata.id"]));
  return {
    ciCode: server.ciCode,
    system: system as RedfishSystemBundle["system"],
    thermal: get(`${chassis}/Thermal`),
    power: get(`${chassis}/Power`),
    drives,
    observedAt: "2026-10-07T12:00:00.000Z",
  };
}

describe("simulated iDRAC Redfish", () => {
  it("reads HEALTHY through the real Redfish adapter when nothing is wrong", () => {
    const [dell] = site();
    const snap = normalizeRedfishSystem(bundle(dell));
    expect(snap.overallHealth).toBe("HEALTHY");
    expect(snap.summary.drives).toEqual({ total: 4, healthy: 4, predictedFailure: 0 });
  });

  it("surfaces a failed drive as a degraded DRIVE with the System as rollup", () => {
    const [dell] = site();
    dell.components.find((c) => c.id === "disk-3")!.health = "Critical";
    const snap = normalizeRedfishSystem(bundle(dell));
    expect(snap.overallHealth).toBe("CRITICAL");
    expect(snap.degraded).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "SYSTEM", rollup: true }),
        expect.objectContaining({ kind: "DRIVE", name: "Physical Disk 0:1:3", health: "CRITICAL" }),
      ]),
    );
  });

  it("reports a predicted drive failure (FailurePredicted) as WARNING", () => {
    const [dell] = site();
    dell.components.find((c) => c.id === "disk-1")!.predictive = true;
    const snap = normalizeRedfishSystem(bundle(dell));
    expect(snap.overallHealth).toBe("WARNING");
    expect(snap.predictiveFailures).toEqual([
      expect.objectContaining({ kind: "DRIVE", name: "Physical Disk 0:1:1" }),
    ]);
  });
});

describe("simulated iLO Redfish", () => {
  it("is read by the real HPE adapter, including Oem.Hpe aggregate health", () => {
    const [, hpe] = site();
    hpe.components.find((c) => c.id === "psu-2")!.health = "Warning";
    const snap = normalizeHpeIloSystem(bundle(hpe));
    expect(snap.source).toBe("HPE_ILO");
    expect(snap.overallHealth).toBe("WARNING");
    expect(snap.degraded).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "POWER_SUPPLY", health: "WARNING" }),
      ]),
    );
  });
});

describe("rollup", () => {
  it("is the worst effective component health", () => {
    const [dell] = site();
    expect(rollup(dell.components)).toBe("OK");
    dell.components[0].predictive = true;
    expect(rollup(dell.components)).toBe("Warning");
    dell.components[5].health = "Critical";
    expect(rollup(dell.components)).toBe("Critical");
  });
});

/** Turn a TrapSpec into what the collector's decoder hands the adapter. */
function asTrap(server: SimServer, spec: NonNullable<ReturnType<typeof trapFor>>) {
  return {
    ciCode: server.ciCode,
    agentAddress: server.trapSource,
    trapOid: spec.oid,
    sysUpTimeTicks: 100,
    receivedAt: "2026-10-07T12:00:00.000Z",
    varbinds: spec.varbinds.map((v) => ({ oid: v.oid, value: v.value })),
  };
}

describe("simulated traps match the SNMP adapter's vendor table", () => {
  it("iDRAC drive failure -> CRITICAL hardware.drive_fault keyed by FQDD; repair clears it", () => {
    const [dell] = site();
    const disk = dell.components.find((c) => c.id === "disk-3")!;
    disk.health = "Critical";
    const fail = normalizeSnmpTrap(asTrap(dell, trapFor(dell, disk)!));
    disk.health = "OK";
    const ok = normalizeSnmpTrap(asTrap(dell, trapFor(dell, disk)!));

    expect(fail).toMatchObject({
      alertType: "hardware.drive_fault",
      severity: "CRITICAL",
      state: "OPEN",
      componentKey: disk.fqdd,
    });
    expect(ok).toMatchObject({
      alertType: "hardware.drive_fault",
      state: "RECOVERED",
      componentKey: disk.fqdd,
    });
  });

  it("iDRAC predicted drive failure is a WARNING, not a failure", () => {
    const [dell] = site();
    const disk = dell.components.find((c) => c.id === "disk-0")!;
    disk.predictive = true;
    expect(
      classifyVendorTrap(trapFor(dell, disk)!.oid, asTrap(dell, trapFor(dell, disk)!).varbinds),
    ).toMatchObject({
      severity: "WARNING",
      state: "OPEN",
    });
  });

  it("HPE drive status change carries the drive row and status", () => {
    const [, hpe] = site();
    const disk = hpe.components.find((c) => c.id === "disk-2")!;
    disk.predictive = true;
    expect(normalizeSnmpTrap(asTrap(hpe, trapFor(hpe, disk)!))).toMatchObject({
      alertType: "hardware.drive_fault",
      severity: "HIGH",
      componentKey: "PhyDrv:0.2",
    });
  });

  it("HPE PSU degraded and ok pair on the same component", () => {
    const [, hpe] = site();
    const psu = hpe.components.find((c) => c.id === "psu-1")!;
    psu.health = "Warning";
    const bad = normalizeSnmpTrap(asTrap(hpe, trapFor(hpe, psu)!));
    psu.health = "OK";
    const ok = normalizeSnmpTrap(asTrap(hpe, trapFor(hpe, psu)!));
    expect(bad).toMatchObject({
      alertType: "hardware.power_supply_fault",
      severity: "HIGH",
      componentKey: "PSU:0.1",
    });
    expect(ok).toMatchObject({ state: "RECOVERED", componentKey: "PSU:0.1" });
  });

  it("sends no trap for an HPE fan recovery (real iLO has none)", () => {
    const [, hpe] = site();
    expect(
      trapFor(
        hpe,
        hpe.components.find((c) => c.kind === "fan")!,
      ),
    ).toBeUndefined();
  });
});
