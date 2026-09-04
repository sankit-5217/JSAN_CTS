import { normalizeRedfishSystem, RedfishNormalizationError } from "./normalize";
import type { RedfishSystemBundle } from "./types";

function healthyBundle(overrides: Partial<RedfishSystemBundle> = {}): RedfishSystemBundle {
  return {
    ciCode: "SITE01-R01-SRV-038",
    observedAt: "2026-09-02T10:15:00.000Z",
    system: {
      Id: "System.Embedded.1",
      Name: "srv-038",
      Manufacturer: "Dell Inc.",
      Model: "PowerEdge R660",
      SerialNumber: "CN7016",
      PowerState: "On",
      BiosVersion: "2.1.6",
      Status: { State: "Enabled", Health: "OK", HealthRollup: "OK" },
      ProcessorSummary: { Count: 2, Status: { Health: "OK" } },
      MemorySummary: { TotalSystemMemoryGiB: 512, Status: { Health: "OK" } },
    },
    thermal: {
      Temperatures: [
        {
          Name: "CPU1 Temp",
          ReadingCelsius: 44,
          UpperThresholdCritical: 95,
          Status: { Health: "OK" },
        },
      ],
      Fans: [
        { Name: "Fan1A", Reading: 8400, ReadingUnits: "RPM", Status: { Health: "OK" } },
        { Name: "Fan1B", Reading: 8400, ReadingUnits: "RPM", Status: { Health: "OK" } },
      ],
    },
    power: {
      PowerSupplies: [
        { Name: "PSU1", PowerInputWatts: 480, Status: { State: "Enabled", Health: "OK" } },
        { Name: "PSU2", PowerInputWatts: 470, Status: { State: "Enabled", Health: "OK" } },
      ],
      PowerControl: [{ PowerConsumedWatts: 410 }],
    },
    drives: [
      { Name: "Disk 0", MediaType: "SSD", CapacityBytes: 960197124096, Status: { Health: "OK" } },
      { Name: "Disk 1", MediaType: "SSD", CapacityBytes: 960197124096, Status: { Health: "OK" } },
    ],
    ...overrides,
  };
}

describe("normalizeRedfishSystem", () => {
  it("maps a healthy system to a clean snapshot", () => {
    const snapshot = normalizeRedfishSystem(healthyBundle());

    expect(snapshot).toMatchObject({
      ciCode: "SITE01-R01-SRV-038",
      source: "REDFISH",
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
  });

  it("flags a predicted drive failure and lifts overall health to WARNING", () => {
    const bundle = healthyBundle();
    bundle.drives = [
      { Name: "Disk 0", MediaType: "SSD", Status: { Health: "OK" } },
      {
        Name: "Disk 1",
        MediaType: "SSD",
        FailurePredicted: true,
        PredictedMediaLifeLeftPercent: 3,
        Status: { Health: "OK" },
      },
    ];

    const snapshot = normalizeRedfishSystem(bundle);

    expect(snapshot.overallHealth).toBe("WARNING");
    expect(snapshot.predictiveFailures).toEqual([
      { kind: "DRIVE", name: "Disk 1", detail: "SSD, 3% media life left, FailurePredicted" },
    ]);
    expect(snapshot.summary.drives).toEqual({ total: 2, healthy: 2, predictedFailure: 1 });
  });

  it("collects degraded components and rolls up to the worst state", () => {
    const bundle = healthyBundle();
    bundle.system.Status = { State: "Enabled", Health: "Critical", HealthRollup: "Critical" };
    bundle.thermal = {
      Temperatures: bundle.thermal?.Temperatures,
      Fans: [
        { Name: "Fan1A", Reading: 0, ReadingUnits: "RPM", Status: { Health: "Warning" } },
        { Name: "Fan1B", Reading: 8400, ReadingUnits: "RPM", Status: { Health: "OK" } },
      ],
    };

    const snapshot = normalizeRedfishSystem(bundle);

    expect(snapshot.overallHealth).toBe("CRITICAL");
    expect(snapshot.degraded).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "SYSTEM", health: "CRITICAL" }),
        expect.objectContaining({ kind: "FAN", name: "Fan1A", health: "WARNING", detail: "0RPM" }),
      ]),
    );
    expect(snapshot.summary.fans).toEqual({ total: 2, healthy: 1 });
  });

  it("treats a temperature at/over its critical threshold as CRITICAL", () => {
    const bundle = healthyBundle();
    bundle.thermal = {
      Temperatures: [
        {
          Name: "Inlet Temp",
          ReadingCelsius: 96,
          UpperThresholdCritical: 95,
          Status: { Health: "OK" },
        },
      ],
      Fans: bundle.thermal?.Fans,
    };

    const snapshot = normalizeRedfishSystem(bundle);

    expect(snapshot.overallHealth).toBe("CRITICAL");
    expect(snapshot.degraded).toContainEqual({
      kind: "TEMPERATURE_SENSOR",
      name: "Inlet Temp",
      health: "CRITICAL",
      detail: "96C >= critical 95C",
    });
  });

  it("ignores components reported as Absent", () => {
    const bundle = healthyBundle();
    bundle.power = {
      PowerSupplies: [
        { Name: "PSU1", Status: { State: "Enabled", Health: "OK" } },
        { Name: "PSU2", Status: { State: "Absent" } },
      ],
    };

    const snapshot = normalizeRedfishSystem(bundle);

    expect(snapshot.degraded).toEqual([]);
    expect(snapshot.summary.powerSupplies).toEqual({ total: 1, healthy: 1 });
  });

  it("maps power state and unknown health", () => {
    const bundle = healthyBundle({
      system: { Id: "1", PowerState: "Off", Status: { State: "Disabled" } },
      thermal: undefined,
      power: undefined,
      drives: [],
    });

    const snapshot = normalizeRedfishSystem(bundle);

    expect(snapshot.powerState).toBe("OFF");
    expect(snapshot.overallHealth).toBe("UNKNOWN");
    expect(snapshot.firmware).toBeUndefined();
  });

  it("throws RedfishNormalizationError for a bundle with no ciCode or no system", () => {
    expect(() => normalizeRedfishSystem({ ciCode: "  " } as RedfishSystemBundle)).toThrow(
      RedfishNormalizationError,
    );

    try {
      normalizeRedfishSystem({ ciCode: "CI-1" } as RedfishSystemBundle);
      throw new Error("expected normalizeRedfishSystem to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(RedfishNormalizationError);
      expect((err as RedfishNormalizationError).field).toBe("system");
    }
  });
});
