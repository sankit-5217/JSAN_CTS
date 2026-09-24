import { normalizeRedfishSystem } from "@cts-dc-opsdesk/redfish-adapter";
import type { MgmtHttp } from "./mgmt-http";
import { fetchRedfishBundle, MAX_DRIVES_PER_POLL } from "./redfish-fetcher";

const SYSTEM = {
  Id: "System.Embedded.1",
  Name: "srv-040",
  Manufacturer: "Dell Inc.",
  Model: "PowerEdge R660",
  PowerState: "On",
  Status: { State: "Enabled", Health: "OK", HealthRollup: "OK" },
};
const THERMAL = { Fans: [{ Name: "Fan1", Status: { Health: "OK" } }] };

function fakeHttp(routes: Record<string, unknown>, missing: string[] = []): MgmtHttp {
  const get = async (path: string) => {
    if (missing.includes(path)) {
      const err = new Error("404") as Error & { status: number };
      err.status = 404;
      throw err;
    }
    if (!(path in routes)) {
      throw new Error(`unexpected GET ${path}`);
    }
    return routes[path];
  };
  return {
    get,
    tryGet: async (path: string) => (missing.includes(path) ? undefined : get(path)),
  } as unknown as MgmtHttp;
}

describe("fetchRedfishBundle", () => {
  it("assembles a bundle from Systems -> System -> Chassis Thermal/Power", async () => {
    const http = fakeHttp({
      "/redfish/v1/Systems": { Members: [{ "@odata.id": "/redfish/v1/Systems/1" }] },
      "/redfish/v1/Systems/1": SYSTEM,
      "/redfish/v1/Chassis": { Members: [{ "@odata.id": "/redfish/v1/Chassis/1" }] },
      "/redfish/v1/Chassis/1/Thermal": THERMAL,
      "/redfish/v1/Chassis/1/Power": {
        PowerSupplies: [{ Name: "PSU1", Status: { Health: "OK" } }],
      },
    });

    const bundle = await fetchRedfishBundle(
      http,
      "SITE01-R01-SRV-040",
      () => "2026-09-03T10:00:00.000Z",
    );

    expect(bundle).toEqual({
      ciCode: "SITE01-R01-SRV-040",
      system: SYSTEM,
      thermal: THERMAL,
      power: { PowerSupplies: [{ Name: "PSU1", Status: { Health: "OK" } }] },
      observedAt: "2026-09-03T10:00:00.000Z",
    });
  });

  it("omits Thermal/Power when the chassis sub-resources 404", async () => {
    const http = fakeHttp(
      {
        "/redfish/v1/Systems": { Members: [{ "@odata.id": "/redfish/v1/Systems/1" }] },
        "/redfish/v1/Systems/1": SYSTEM,
        "/redfish/v1/Chassis": { Members: [{ "@odata.id": "/redfish/v1/Chassis/1" }] },
      },
      [
        "/redfish/v1/Chassis/1/Thermal",
        "/redfish/v1/Chassis/1/Power",
        "/redfish/v1/Systems/1/Storage",
      ],
    );

    const bundle = await fetchRedfishBundle(http, "CI-1", () => "T");
    expect(bundle).toEqual({ ciCode: "CI-1", system: SYSTEM, observedAt: "T" });
  });

  describe("drives", () => {
    const BASE = {
      "/redfish/v1/Systems": { Members: [{ "@odata.id": "/redfish/v1/Systems/1" }] },
      "/redfish/v1/Chassis": { Members: [] },
    };
    const DRIVE_OK = { Name: "Disk 0", MediaType: "SSD", Status: { Health: "OK" } };
    const DRIVE_FAILING = {
      Name: "Disk 1",
      MediaType: "HDD",
      FailurePredicted: true,
      Status: { State: "Enabled", Health: "Warning" },
    };

    it("walks System.Storage -> controllers -> Drives and flattens every drive", async () => {
      const http = fakeHttp({
        ...BASE,
        "/redfish/v1/Systems/1": {
          ...SYSTEM,
          Storage: { "@odata.id": "/redfish/v1/Systems/1/Storage" },
        },
        "/redfish/v1/Systems/1/Storage": {
          Members: [
            { "@odata.id": "/redfish/v1/Systems/1/Storage/RAID.1" },
            { "@odata.id": "/redfish/v1/Systems/1/Storage/AHCI.1" },
          ],
        },
        "/redfish/v1/Systems/1/Storage/RAID.1": {
          Drives: [{ "@odata.id": "/redfish/v1/Systems/1/Storage/RAID.1/Drives/0" }],
        },
        "/redfish/v1/Systems/1/Storage/AHCI.1": {
          Drives: [{ "@odata.id": "/redfish/v1/Systems/1/Storage/AHCI.1/Drives/1" }],
        },
        "/redfish/v1/Systems/1/Storage/RAID.1/Drives/0": DRIVE_OK,
        "/redfish/v1/Systems/1/Storage/AHCI.1/Drives/1": DRIVE_FAILING,
      });

      const bundle = await fetchRedfishBundle(http, "CI-1", () => "T");

      expect(bundle.drives).toEqual([DRIVE_OK, DRIVE_FAILING]);
      // The adapter turns the failing drive into a predictive failure + WARNING.
      const snapshot = normalizeRedfishSystem(bundle);
      expect(snapshot.predictiveFailures).toEqual([
        expect.objectContaining({ kind: "DRIVE", name: "Disk 1" }),
      ]);
      expect(snapshot.overallHealth).toBe("WARNING");
      expect(snapshot.summary.drives).toEqual(
        expect.objectContaining({ total: 2, healthy: 1, predictedFailure: 1 }),
      );
    });

    it("falls back to <system>/Storage when the System has no Storage link", async () => {
      const http = fakeHttp({
        ...BASE,
        "/redfish/v1/Systems/1": SYSTEM,
        "/redfish/v1/Systems/1/Storage": {
          Members: [{ "@odata.id": "/redfish/v1/Systems/1/Storage/1" }],
        },
        "/redfish/v1/Systems/1/Storage/1": {
          Drives: [{ "@odata.id": "/redfish/v1/Systems/1/Storage/1/Drives/0" }],
        },
        "/redfish/v1/Systems/1/Storage/1/Drives/0": DRIVE_OK,
      });
      const bundle = await fetchRedfishBundle(http, "CI-1", () => "T");
      expect(bundle.drives).toEqual([DRIVE_OK]);
    });

    it("skips a drive that 404s and keeps the rest", async () => {
      const http = fakeHttp(
        {
          ...BASE,
          "/redfish/v1/Systems/1": SYSTEM,
          "/redfish/v1/Systems/1/Storage": {
            Members: [{ "@odata.id": "/redfish/v1/Systems/1/Storage/1" }],
          },
          "/redfish/v1/Systems/1/Storage/1": {
            Drives: [
              { "@odata.id": "/redfish/v1/Systems/1/Storage/1/Drives/0" },
              { "@odata.id": "/redfish/v1/Systems/1/Storage/1/Drives/1" },
            ],
          },
          "/redfish/v1/Systems/1/Storage/1/Drives/1": DRIVE_FAILING,
        },
        ["/redfish/v1/Systems/1/Storage/1/Drives/0"],
      );
      const bundle = await fetchRedfishBundle(http, "CI-1", () => "T");
      expect(bundle.drives).toEqual([DRIVE_FAILING]);
    });

    it("leaves drives out, but keeps the rest of the reading, when storage errors", async () => {
      const http = fakeHttp({
        ...BASE,
        "/redfish/v1/Systems/1": SYSTEM,
        // no route for /Storage: the fake throws a non-404 error
      });
      const bundle = await fetchRedfishBundle(http, "CI-1", () => "T");
      expect(bundle).toEqual({ ciCode: "CI-1", system: SYSTEM, observedAt: "T" });
    });

    it("stops after MAX_DRIVES_PER_POLL drives", async () => {
      const count = MAX_DRIVES_PER_POLL + 5;
      const routes: Record<string, unknown> = {
        ...BASE,
        "/redfish/v1/Systems/1": SYSTEM,
        "/redfish/v1/Systems/1/Storage": {
          Members: [{ "@odata.id": "/redfish/v1/Systems/1/Storage/1" }],
        },
        "/redfish/v1/Systems/1/Storage/1": {
          Drives: Array.from({ length: count }, (_, i) => ({
            "@odata.id": `/redfish/v1/Systems/1/Storage/1/Drives/${i}`,
          })),
        },
      };
      for (let i = 0; i < count; i++) {
        routes[`/redfish/v1/Systems/1/Storage/1/Drives/${i}`] = { Name: `Disk ${i}` };
      }
      const bundle = await fetchRedfishBundle(fakeHttp(routes), "CI-1", () => "T");
      expect(bundle.drives).toHaveLength(MAX_DRIVES_PER_POLL);
    });
  });

  it("throws when the endpoint exposes no ComputerSystem", async () => {
    const http = fakeHttp({ "/redfish/v1/Systems": { Members: [] } });
    await expect(fetchRedfishBundle(http, "CI-1")).rejects.toThrow(/no ComputerSystem/);
  });
});
