import type { MgmtHttp } from "./mgmt-http";
import { fetchOmeDeviceBundle } from "./ome-fetcher";

const DEVICE = {
  Id: 10001,
  DeviceServiceTag: "SVCTAG1",
  DeviceName: "srv-040",
  Model: "PowerEdge R660",
  Status: 3000,
  PowerState: 17,
};

function fakeHttp(get: Record<string, unknown>, tryGet: Record<string, unknown>): MgmtHttp {
  return {
    get: async (path: string) => {
      if (!(path in get)) {
        throw new Error(`unexpected GET ${path}`);
      }
      return get[path];
    },
    tryGet: async (path: string) => tryGet[path],
  } as unknown as MgmtHttp;
}

describe("fetchOmeDeviceBundle", () => {
  it("looks the device up by Service Tag and maps SubSystemHealth + InventoryDetails", async () => {
    const http = fakeHttp(
      {
        "/api/DeviceService/Devices?$filter=DeviceServiceTag eq 'SVCTAG1'": { value: [DEVICE] },
      },
      {
        "/api/DeviceService/Devices(10001)/SubSystemHealth": {
          value: [{ SubSystems: [{ Name: "Storage", Status: 4000 }] }],
        },
        "/api/DeviceService/Devices(10001)/InventoryDetails": {
          value: [
            {
              InventoryType: "serverStorageDisks",
              InventoryInfo: [
                {
                  Id: "Disk.0",
                  Name: "Disk 0",
                  MediaType: "SSD",
                  Status: 1000,
                  PredictiveFailureState: "Smart Alert Present",
                  Size: "894 GB",
                },
              ],
            },
            {
              InventoryType: "serverPowerSupplies",
              InventoryInfo: [{ Name: "PSU1", Status: 1000, OutputWatts: 750 }],
            },
            {
              InventoryType: "deviceSoftware",
              InventoryInfo: [{ ComponentType: "BIOS", Version: "2.10.2" }],
            },
          ],
        },
      },
    );

    const bundle = await fetchOmeDeviceBundle(http, "OME-CI", "SVCTAG1", () => "T");

    expect(bundle).toEqual({
      ciCode: "OME-CI",
      device: DEVICE,
      subSystems: [{ Name: "Storage", Status: 4000 }],
      disks: [
        {
          Id: "Disk.0",
          Name: "Disk 0",
          MediaType: "SSD",
          Status: 1000,
          PredictiveFailureState: "Smart Alert Present",
          Size: "894 GB",
        },
      ],
      powerSupplies: [{ Name: "PSU1", Status: 1000, OutputWatts: 750 }],
      biosVersion: "2.10.2",
      observedAt: "T",
    });
  });

  it("returns a device-only bundle when the sub-resources 404", async () => {
    const http = fakeHttp(
      { "/api/DeviceService/Devices?$filter=DeviceServiceTag eq 'SVCTAG1'": { value: [DEVICE] } },
      {}, // tryGet -> undefined for everything
    );
    const bundle = await fetchOmeDeviceBundle(http, "OME-CI", "SVCTAG1", () => "T");
    expect(bundle).toEqual({ ciCode: "OME-CI", device: DEVICE, observedAt: "T" });
  });

  it("throws when OME has no device with that Service Tag", async () => {
    const http = fakeHttp(
      { "/api/DeviceService/Devices?$filter=DeviceServiceTag eq 'NOPE'": { value: [] } },
      {},
    );
    await expect(fetchOmeDeviceBundle(http, "CI", "NOPE")).rejects.toThrow(
      /no device with Service Tag/,
    );
  });
});
