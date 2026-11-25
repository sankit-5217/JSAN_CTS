import { normalizeSnmpTrap } from "./normalize";
import type { SnmpTrap, SnmpTrapVarbind } from "./types";
import { classifyVendorTrap } from "./vendor-traps";

const IDRAC_VB = "1.3.6.1.4.1.674.10892.5.3.1";

function idracVarbinds(fqdd: string, status: number, message = "msg"): SnmpTrapVarbind[] {
  return [
    { oid: `${IDRAC_VB}.1.0`, value: "PDR1016" },
    { oid: `${IDRAC_VB}.2.0`, value: message },
    { oid: `${IDRAC_VB}.3.0`, value: status },
    { oid: `${IDRAC_VB}.4.0`, value: "ABC1234" },
    { oid: `${IDRAC_VB}.6.0`, value: fqdd },
    { oid: `${IDRAC_VB}.7.0`, value: "Physical Disk 0:1:3" },
  ];
}

function trap(trapOid: string, varbinds: SnmpTrapVarbind[]): SnmpTrap {
  return {
    ciCode: "SITE01-R01-SRV-040",
    agentAddress: "10.0.0.40",
    trapOid,
    varbinds,
    sysUpTimeTicks: 123,
    receivedAt: "2026-10-07T08:00:00.000Z",
  };
}

const DISK_FQDD = "Disk.Bay.3:Enclosure.Internal.0-1:RAID.Integrated.1-1";

describe("Dell iDRAC traps", () => {
  it("turns a physical disk failure into a CRITICAL hardware.drive_fault keyed by FQDD", () => {
    const alert = normalizeSnmpTrap(
      trap(
        "1.3.6.1.4.1.674.10892.5.3.2.2.0.4345",
        idracVarbinds(
          DISK_FQDD,
          5,
          "Disk 3 in Backplane 1 of Integrated RAID Controller 1 is failed.",
        ),
      ),
    );

    expect(alert).toMatchObject({
      alertType: "hardware.drive_fault",
      severity: "CRITICAL",
      state: "OPEN",
      componentKey: DISK_FQDD,
    });
    expect(alert.summary).toContain("alertStoragePhysicalDiskFailure");
    expect(alert.summary).toContain("[PDR1016] Disk 3 in Backplane 1");
    expect(alert.attributes).toMatchObject({ vendor: "DELL_IDRAC" });
  });

  it("maps the system-group physical disk trap to the same condition", () => {
    const viaSystem = normalizeSnmpTrap(
      trap("1.3.6.1.4.1.674.10892.5.3.2.1.0.2297", idracVarbinds(DISK_FQDD, 5)),
    );
    const viaStorage = normalizeSnmpTrap(
      trap("1.3.6.1.4.1.674.10892.5.3.2.2.0.4345", idracVarbinds(DISK_FQDD, 5)),
    );
    expect(viaSystem.alertType).toBe(viaStorage.alertType);
    expect(viaSystem.componentKey).toBe(viaStorage.componentKey);
  });

  it("treats a ...Normal trap as the recovery of its condition", () => {
    const fail = classifyVendorTrap(
      "1.3.6.1.4.1.674.10892.5.3.2.1.0.2185",
      idracVarbinds("PSU.Slot.2", 5),
    );
    const normal = classifyVendorTrap(
      "1.3.6.1.4.1.674.10892.5.3.2.1.0.2187",
      idracVarbinds("PSU.Slot.2", 3),
    );
    expect(fail).toMatchObject({
      alertType: "hardware.power_supply_fault",
      severity: "CRITICAL",
      state: "OPEN",
    });
    expect(normal).toMatchObject({ alertType: "hardware.power_supply_fault", state: "RECOVERED" });
    expect(normal?.componentKey).toBe(fail?.componentKey);
  });

  it("treats an ...Information trap as a recovery only when the status reads ok", () => {
    const ok = classifyVendorTrap(
      "1.3.6.1.4.1.674.10892.5.3.2.2.0.4347",
      idracVarbinds(DISK_FQDD, 3),
    );
    const rebuilding = classifyVendorTrap(
      "1.3.6.1.4.1.674.10892.5.3.2.2.0.4347",
      idracVarbinds(DISK_FQDD, 4),
    );
    expect(ok).toMatchObject({ state: "RECOVERED" });
    expect(rebuilding).toMatchObject({ state: "OPEN", severity: "INFO" });
  });

  it("clears a PSU-absent fault with the PSU Normal trap (shared alertType)", () => {
    const absent = classifyVendorTrap(
      "1.3.6.1.4.1.674.10892.5.3.2.1.0.2465",
      idracVarbinds("PSU.Slot.1", 5),
    );
    expect(absent).toMatchObject({ alertType: "hardware.power_supply_fault", severity: "HIGH" });
  });
});

describe("HPE traps", () => {
  const STATUS = "1.3.6.1.4.1.232.3.2.5.1.1.6";

  function phyDrv(status: number): SnmpTrapVarbind[] {
    return [
      { oid: "1.3.6.1.2.1.1.5.0", value: "srv040" },
      { oid: `1.3.6.1.4.1.232.3.2.5.1.1.64.0.2`, value: "Port 1I Box 1 Bay 2" },
      { oid: `1.3.6.1.4.1.232.3.2.5.1.1.51.0.2`, value: "WFK0ABCD" },
      { oid: `${STATUS}.0.2`, value: status },
    ];
  }

  it("reads the drive status varbind: failed(3) is CRITICAL, keyed by controller.drive", () => {
    const alert = normalizeSnmpTrap(trap("1.3.6.1.4.1.232.0.3046", phyDrv(3)));
    expect(alert).toMatchObject({
      alertType: "hardware.drive_fault",
      severity: "CRITICAL",
      state: "OPEN",
      componentKey: "PhyDrv:0.2",
    });
    expect(alert.summary).toContain("Port 1I Box 1 Bay 2");
    expect(alert.summary).toContain("serial WFK0ABCD");
  });

  it("maps predictiveFailure(4) to HIGH and ok(2) to a recovery of the same drive", () => {
    const predictive = classifyVendorTrap("1.3.6.1.4.1.232.0.3036", phyDrv(4));
    const ok = classifyVendorTrap("1.3.6.1.4.1.232.0.3036", phyDrv(2));
    expect(predictive).toMatchObject({ severity: "HIGH", state: "OPEN" });
    expect(ok).toMatchObject({ state: "RECOVERED", componentKey: predictive?.componentKey });
  });

  it("recognises the legacy cpqDriveArray-enterprise drive trap", () => {
    expect(classifyVendorTrap("1.3.6.1.4.1.232.3.0.3", phyDrv(3))).toMatchObject({
      alertType: "hardware.drive_fault",
      severity: "CRITICAL",
    });
  });

  it("raises a threshold-passed drive trap as a HIGH predictive failure", () => {
    expect(classifyVendorTrap("1.3.6.1.4.1.232.0.3037", phyDrv(2))).toMatchObject({
      alertType: "hardware.drive_predictive_failure",
      severity: "HIGH",
      state: "OPEN",
      componentKey: "PhyDrv:0.2",
    });
  });

  it("pairs PSU failed and PSU ok by chassis.bay", () => {
    const vbs = [{ oid: "1.3.6.1.4.1.232.6.2.9.3.1.2.0.2", value: 2 }];
    const failed = classifyVendorTrap("1.3.6.1.4.1.232.0.6050", vbs);
    const ok = classifyVendorTrap("1.3.6.1.4.1.232.0.6048", vbs);
    expect(failed).toMatchObject({
      alertType: "hardware.power_supply_fault",
      severity: "CRITICAL",
      componentKey: "PSU:0.2",
    });
    expect(ok).toMatchObject({
      alertType: "hardware.power_supply_fault",
      state: "RECOVERED",
      componentKey: "PSU:0.2",
    });
  });

  it("maps a logical drive failure and a rebuild", () => {
    const status = "1.3.6.1.4.1.232.3.2.3.1.1.4.0.1";
    expect(classifyVendorTrap("1.3.6.1.4.1.232.0.3034", [{ oid: status, value: 3 }])).toMatchObject(
      {
        alertType: "hardware.logical_drive_fault",
        severity: "CRITICAL",
        componentKey: "LogDrv:0.1",
      },
    );
    expect(classifyVendorTrap("1.3.6.1.4.1.232.0.3034", [{ oid: status, value: 7 }])).toMatchObject(
      {
        severity: "HIGH",
        state: "OPEN",
      },
    );
  });
});

describe("precedence", () => {
  it("lets a collector-supplied severity / clears override the vendor mapping", () => {
    const alert = normalizeSnmpTrap({
      ...trap("1.3.6.1.4.1.674.10892.5.3.2.2.0.4345", idracVarbinds(DISK_FQDD, 5)),
      severity: "WARNING",
      clears: true,
    });
    expect(alert).toMatchObject({ severity: "WARNING", state: "RECOVERED" });
  });

  it("leaves unknown enterprise traps on the generic path", () => {
    expect(classifyVendorTrap("1.3.6.1.4.1.9999.0.1", [])).toBeUndefined();
  });
});
