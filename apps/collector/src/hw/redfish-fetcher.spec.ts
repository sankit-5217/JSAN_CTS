import type { MgmtHttp } from "./mgmt-http";
import { fetchRedfishBundle } from "./redfish-fetcher";

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
      ["/redfish/v1/Chassis/1/Thermal", "/redfish/v1/Chassis/1/Power"],
    );

    const bundle = await fetchRedfishBundle(http, "CI-1", () => "T");
    expect(bundle).toEqual({ ciCode: "CI-1", system: SYSTEM, observedAt: "T" });
  });

  it("throws when the endpoint exposes no ComputerSystem", async () => {
    const http = fakeHttp({ "/redfish/v1/Systems": { Members: [] } });
    await expect(fetchRedfishBundle(http, "CI-1")).rejects.toThrow(/no ComputerSystem/);
  });
});
