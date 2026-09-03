import {
  DellOmeNormalizationError,
  normalizeDellOmeDevice,
  normalizeDellOmeDevices,
} from "./normalize";
import type { DellOmeDeviceBundle } from "./types";

function healthyBundle(overrides: Partial<DellOmeDeviceBundle> = {}): DellOmeDeviceBundle {
  return {
    ciCode: "SITE01-R01-SRV-040",
    observedAt: "2026-09-02T10:15:00.000Z",
    biosVersion: "2.1.6",
    device: {
      Id: 10001,
      DeviceServiceTag: "SVCTAG1",
      DeviceName: "srv-040",
      Model: "PowerEdge R660",
      Type: 1000,
      Status: 1000,
      PowerState: 17,
      ConnectionState: true,
      ManagementIp: "10.20.1.40",
    },
    subSystems: [
      { Name: "Temperature", Status: 1000 },
      { Name: "Fan", Status: 1000 },
      { Name: "Memory", Status: 1000 },
      { Name: "Processor", Status: 1000 },
      { Name: "Storage", Status: 1000 },
      { Name: "PowerSupply", Status: 1000 },
    ],
    disks: [
      { Name: "Disk 0", MediaType: "SSD", Size: "894 GB", Status: 1000 },
      { Name: "Disk 1", MediaType: "SSD", Size: "894 GB", Status: 1000 },
    ],
    powerSupplies: [
      { Name: "PSU1", OutputWatts: 480, Status: 1000 },
      { Name: "PSU2", OutputWatts: 470, Status: 1000 },
    ],
    fans: [
      { Name: "Fan1A", Speed: 8400, Status: 1000 },
      { Name: "Fan1B", Speed: 8400, Status: 1000 },
    ],
    ...overrides,
  };
}

describe("normalizeDellOmeDevice", () => {
  it("maps a healthy device to a clean snapshot", () => {
    const snapshot = normalizeDellOmeDevice(healthyBundle());

    expect(snapshot).toMatchObject({
      ciCode: "SITE01-R01-SRV-040",
      source: "DELL_OME",
      overallHealth: "HEALTHY",
      powerState: "ON",
      observedAt: "2026-09-02T10:15:00.000Z",
      degraded: [],
      predictiveFailures: [],
    });
    expect(snapshot.summary).toEqual({
      drives: { total: 2, healthy: 2, predictedFailure: 0 },
      fans: { total: 2, healthy: 2 },
      powerSupplies: { total: 2, healthy: 2 },
    });
    expect(snapshot.firmware).toEqual({ biosVersion: "2.1.6" });
    expect(snapshot.attributes).toMatchObject({ serviceTag: "SVCTAG1", omeDeviceId: 10001 });
  });

  it("flags a SMART predictive failure and lifts overall health to WARNING", () => {
    const bundle = healthyBundle();
    bundle.disks = [
      { Name: "Disk 0", MediaType: "SSD", Status: 1000 },
      {
        Name: "Disk 1",
        MediaType: "SSD",
        Status: 1000,
        PredictiveFailureState: "Smart Alert Present",
        RemainingReadWriteEndurance: "4 %",
      },
    ];

    const snapshot = normalizeDellOmeDevice(bundle);

    expect(snapshot.overallHealth).toBe("WARNING");
    expect(snapshot.predictiveFailures).toEqual([
      { kind: "DRIVE", name: "Disk 1", detail: "SSD, 4 % endurance left, Smart Alert Present" },
    ]);
    expect(snapshot.summary.drives).toEqual({ total: 2, healthy: 2, predictedFailure: 1 });
  });

  it("collects degraded sub-systems and specific parts, rolling up to the worst state", () => {
    const bundle = healthyBundle();
    bundle.device.Status = 4000;
    bundle.subSystems = [
      { Name: "Temperature", Status: 3000 },
      { Name: "Storage", Status: 4000 },
      { Name: "Voltage", Status: 3000 },
    ];
    bundle.powerSupplies = [
      { Name: "PSU1", Status: 1000 },
      { Name: "PSU2", Status: 3000 },
    ];

    const snapshot = normalizeDellOmeDevice(bundle);

    expect(snapshot.overallHealth).toBe("CRITICAL");
    expect(snapshot.degraded).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "SYSTEM", health: "CRITICAL" }),
        expect.objectContaining({
          kind: "TEMPERATURE_SENSOR",
          name: "Temperature",
          health: "WARNING",
        }),
        expect.objectContaining({
          kind: "STORAGE_CONTROLLER",
          name: "Storage",
          health: "CRITICAL",
        }),
        expect.objectContaining({ kind: "SYSTEM", name: "Voltage", health: "WARNING" }),
        expect.objectContaining({ kind: "POWER_SUPPLY", name: "PSU2", health: "WARNING" }),
      ]),
    );
    expect(snapshot.summary.powerSupplies).toEqual({ total: 2, healthy: 1 });
  });

  it("understands the legacy OMSA status scale (3 = OK, 5 = Critical)", () => {
    const bundle = healthyBundle({
      subSystems: [
        { Name: "Memory", Status: 3 },
        { Name: "Processor", Status: 5 },
      ],
      disks: [],
      powerSupplies: [],
      fans: [],
    });
    bundle.device.Status = 3;

    const snapshot = normalizeDellOmeDevice(bundle);

    expect(snapshot.overallHealth).toBe("CRITICAL");
    expect(snapshot.degraded).toEqual([
      { kind: "PROCESSOR", name: "Processor", health: "CRITICAL", detail: undefined },
    ]);
  });

  it("maps power state, and surfaces an unreachable device as UNKNOWN", () => {
    const snapshot = normalizeDellOmeDevice(
      healthyBundle({
        device: {
          Id: 1,
          DeviceServiceTag: "T",
          Status: 2000,
          PowerState: 18,
          ConnectionState: false,
        },
        subSystems: [],
        disks: [],
        powerSupplies: [],
        fans: [],
        biosVersion: undefined,
      }),
    );

    expect(snapshot.powerState).toBe("OFF");
    expect(snapshot.overallHealth).toBe("UNKNOWN");
    expect(snapshot.firmware).toBeUndefined();
    expect(snapshot.degraded).toEqual([
      { kind: "SYSTEM", name: "T", health: "UNKNOWN", detail: undefined },
    ]);
    expect(snapshot.attributes).toMatchObject({ connected: false });
  });

  it("throws DellOmeNormalizationError for a bundle with no ciCode or no device", () => {
    expect(() => normalizeDellOmeDevice({ ciCode: "  " } as DellOmeDeviceBundle)).toThrow(
      DellOmeNormalizationError,
    );

    try {
      normalizeDellOmeDevice({ ciCode: "CI-1" } as DellOmeDeviceBundle);
      throw new Error("expected normalizeDellOmeDevice to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(DellOmeNormalizationError);
      expect((err as DellOmeNormalizationError).field).toBe("device");
    }
  });
});

describe("normalizeDellOmeDevices", () => {
  it("normalizes a fleet and collects per-device rejections without throwing", () => {
    const result = normalizeDellOmeDevices([
      healthyBundle({ ciCode: "SITE01-R01-SRV-040" }),
      { ciCode: "SITE01-R01-SRV-041" } as DellOmeDeviceBundle, // no device
      healthyBundle({ ciCode: "SITE01-R01-SRV-042" }),
    ]);

    expect(result.snapshots.map((s) => s.ciCode)).toEqual([
      "SITE01-R01-SRV-040",
      "SITE01-R01-SRV-042",
    ]);
    expect(result.rejected).toEqual([
      { index: 1, field: "device", message: expect.stringContaining("no device resource") },
    ]);
  });
});
