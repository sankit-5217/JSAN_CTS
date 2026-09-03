import { HpeIloNormalizationError, normalizeHpeIloSystem } from "./normalize";
import type { HpeIloSystemBundle } from "./types";

function healthyBundle(overrides: Partial<HpeIloSystemBundle> = {}): HpeIloSystemBundle {
  return {
    ciCode: "SITE01-R02-SRV-011",
    observedAt: "2026-09-02T10:15:00.000Z",
    system: {
      Id: "1",
      Name: "srv-011",
      Manufacturer: "HPE",
      Model: "ProLiant DL380 Gen10",
      SerialNumber: "SGH1234",
      PowerState: "On",
      BiosVersion: "U30 v2.78",
      Status: { State: "Enabled", Health: "OK", HealthRollup: "OK" },
      ProcessorSummary: { Count: 2, Status: { Health: "OK" } },
      MemorySummary: { TotalSystemMemoryGiB: 384, Status: { Health: "OK" } },
      Oem: {
        Hpe: {
          IloVersion: "iLO 5 v2.78",
          PostState: "FinishedPost",
          AggregateHealthStatus: {
            BiosOrHardwareHealth: { Status: { Health: "OK" } },
            Fans: { Status: { Health: "OK" } },
            Memory: { Status: { Health: "OK" } },
            PowerSupplies: { Status: { Health: "OK" } },
            Processors: { Status: { Health: "OK" } },
            SmartStorageBattery: { Status: { Health: "OK" } },
            Storage: { Status: { Health: "OK" } },
            Temperatures: { Status: { Health: "OK" } },
          },
          SmartStorageBattery: [
            {
              Index: 1,
              ProductName: "HPE Smart Storage Battery",
              Charging: false,
              RemainingChargePercent: 100,
              Status: { State: "Enabled", Health: "OK" },
            },
          ],
        },
      },
    },
    thermal: {
      Temperatures: [
        {
          Name: "01-Inlet Ambient",
          ReadingCelsius: 21,
          UpperThresholdCritical: 46,
          Status: { Health: "OK" },
        },
      ],
      Fans: [
        { Name: "Fan 1", Reading: 24, ReadingUnits: "Percent", Status: { Health: "OK" } },
        { Name: "Fan 2", Reading: 24, ReadingUnits: "Percent", Status: { Health: "OK" } },
      ],
    },
    power: {
      PowerSupplies: [
        { Name: "HpeServerPowerSupply 1", Status: { State: "Enabled", Health: "OK" } },
        { Name: "HpeServerPowerSupply 2", Status: { State: "Enabled", Health: "OK" } },
      ],
    },
    drives: [
      { Name: "Drive 1", MediaType: "SSD", Status: { Health: "OK" } },
      { Name: "Drive 2", MediaType: "SSD", Status: { Health: "OK" } },
    ],
    ...overrides,
  };
}

describe("normalizeHpeIloSystem", () => {
  it("maps a healthy iLO system to a clean snapshot with HPE attributes", () => {
    const snapshot = normalizeHpeIloSystem(healthyBundle());

    expect(snapshot).toMatchObject({
      ciCode: "SITE01-R02-SRV-011",
      source: "HPE_ILO",
      overallHealth: "HEALTHY",
      powerState: "ON",
      degraded: [],
      predictiveFailures: [],
    });
    expect(snapshot.attributes).toMatchObject({
      manufacturer: "HPE",
      model: "ProLiant DL380 Gen10",
      iloVersion: "iLO 5 v2.78",
      postState: "FinishedPost",
    });
    expect(snapshot.summary.powerSupplies).toEqual({ total: 2, healthy: 2 });
  });

  it("surfaces a degraded Smart Storage Battery and lifts overall health", () => {
    const bundle = healthyBundle();
    bundle.system.Oem!.Hpe!.SmartStorageBattery = [
      {
        Index: 1,
        ProductName: "HPE Smart Storage Battery",
        Charging: true,
        RemainingChargePercent: 12,
        Status: { State: "Enabled", Health: "Warning" },
      },
    ];

    const snapshot = normalizeHpeIloSystem(bundle);

    expect(snapshot.overallHealth).toBe("WARNING");
    expect(snapshot.degraded).toContainEqual({
      kind: "SYSTEM",
      name: "HPE Smart Storage Battery",
      health: "WARNING",
      detail: "HPE Smart Storage Battery, 12% charge, charging",
    });
  });

  it("uses AggregateHealthStatus as a fallback when a sub-resource was not fetched", () => {
    const bundle = healthyBundle({ thermal: undefined });
    bundle.system.Oem!.Hpe!.AggregateHealthStatus!.Fans = { Status: { Health: "Warning" } };

    const snapshot = normalizeHpeIloSystem(bundle);

    expect(snapshot.overallHealth).toBe("WARNING");
    expect(snapshot.degraded).toContainEqual({
      kind: "FAN",
      name: "Hpe.AggregateHealthStatus.Fans",
      health: "WARNING",
    });
  });

  it("does not double-report a subsystem the Redfish baseline already flagged", () => {
    const bundle = healthyBundle();
    // baseline sees one bad fan from Thermal…
    bundle.thermal!.Fans = [
      { Name: "Fan 1", Reading: 0, ReadingUnits: "Percent", Status: { Health: "Warning" } },
      { Name: "Fan 2", Reading: 24, ReadingUnits: "Percent", Status: { Health: "OK" } },
    ];
    // …and the HPE aggregate also says Fans are Critical — the rollup is skipped.
    bundle.system.Oem!.Hpe!.AggregateHealthStatus!.Fans = { Status: { Health: "Critical" } };

    const snapshot = normalizeHpeIloSystem(bundle);

    const fanEntries = snapshot.degraded.filter((d) => d.kind === "FAN");
    expect(fanEntries).toEqual([
      expect.objectContaining({ kind: "FAN", name: "Fan 1", health: "WARNING" }),
    ]);
    expect(snapshot.overallHealth).toBe("WARNING");
  });

  it("passes a Redfish predictive drive failure straight through", () => {
    const bundle = healthyBundle();
    bundle.drives = [
      { Name: "Drive 1", MediaType: "SSD", Status: { Health: "OK" } },
      { Name: "Drive 2", MediaType: "SSD", FailurePredicted: true, Status: { Health: "OK" } },
    ];

    const snapshot = normalizeHpeIloSystem(bundle);

    expect(snapshot.predictiveFailures).toEqual([
      expect.objectContaining({ kind: "DRIVE", name: "Drive 2" }),
    ]);
    expect(snapshot.overallHealth).toBe("WARNING");
  });

  it("throws HpeIloNormalizationError for a bundle with no ciCode or no system", () => {
    expect(() => normalizeHpeIloSystem({ ciCode: "  " } as HpeIloSystemBundle)).toThrow(
      HpeIloNormalizationError,
    );

    try {
      normalizeHpeIloSystem({ ciCode: "CI-1" } as HpeIloSystemBundle);
      throw new Error("expected normalizeHpeIloSystem to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(HpeIloNormalizationError);
      expect((err as HpeIloNormalizationError).field).toBe("system");
    }
  });
});
