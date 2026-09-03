import type {
  DellOmeDeviceBundle,
  OmeDevice,
  OmeDisk,
  OmePowerSupply,
  OmeSubSystem,
} from "@cts-dc-opsdesk/dell-ome-adapter";
import type { MgmtHttp } from "./mgmt-http";

/**
 * Assemble a {@link DellOmeDeviceBundle} for one device managed by an OpenManage
 * Enterprise appliance. Read-only: Devices lookup by Service Tag, then the
 * SubSystemHealth rollup and the disk / PSU / BIOS rows out of InventoryDetails.
 * Sub-resources are best-effort (skipped on 404); the dell-ome-adapter tolerates
 * a partial bundle.
 */

interface OmeCollection<T> {
  value?: T[];
}
interface OmeInventorySection {
  InventoryType?: string;
  InventoryInfo?: Array<Record<string, unknown>>;
}

const DISK_TYPES = ["serverStorageDisks", "deviceDisk", "serverDeviceStorage"];
const PSU_TYPES = ["serverPowerSupplies", "devicePowerSupply"];
const BIOS_TYPES = ["deviceSoftware", "serverDeviceSoftware"];

function s(row: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === "string" && v.trim()) {
      return v.trim();
    }
  }
  return undefined;
}
function n(row: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === "number") {
      return v;
    }
  }
  return undefined;
}

function toDisk(row: Record<string, unknown>): OmeDisk {
  return {
    ...(s(row, "Id") ? { Id: s(row, "Id") } : {}),
    ...(s(row, "Name", "DiskNumber") ? { Name: s(row, "Name", "DiskNumber") } : {}),
    ...(s(row, "SerialNumber") ? { SerialNumber: s(row, "SerialNumber") } : {}),
    ...(s(row, "ModelNumber", "Model") ? { ModelNumber: s(row, "ModelNumber", "Model") } : {}),
    ...(s(row, "MediaType") ? { MediaType: s(row, "MediaType") } : {}),
    ...(n(row, "Status") !== undefined ? { Status: n(row, "Status") } : {}),
    ...(s(row, "PredictiveFailureState")
      ? { PredictiveFailureState: s(row, "PredictiveFailureState") }
      : {}),
    ...(s(row, "RemainingReadWriteEndurance")
      ? { RemainingReadWriteEndurance: s(row, "RemainingReadWriteEndurance") }
      : {}),
    ...(s(row, "Size", "Capacity") ? { Size: s(row, "Size", "Capacity") } : {}),
  };
}

function toPsu(row: Record<string, unknown>): OmePowerSupply {
  return {
    ...(s(row, "Name") ? { Name: s(row, "Name") } : {}),
    ...(s(row, "SerialNumber") ? { SerialNumber: s(row, "SerialNumber") } : {}),
    ...(n(row, "Status") !== undefined ? { Status: n(row, "Status") } : {}),
    ...(n(row, "OutputWatts", "PowerSupplyWattage") !== undefined
      ? { OutputWatts: n(row, "OutputWatts", "PowerSupplyWattage") }
      : {}),
  };
}

export async function fetchOmeDeviceBundle(
  http: MgmtHttp,
  ciCode: string,
  deviceRef: string,
  now: () => string = () => new Date().toISOString(),
): Promise<DellOmeDeviceBundle> {
  const escaped = deviceRef.replace(/'/g, "''");
  const found = await http.get<OmeCollection<OmeDevice>>(
    `/api/DeviceService/Devices?$filter=DeviceServiceTag eq '${escaped}'`,
  );
  const device = found.value?.[0];
  if (!device) {
    throw new Error(`OME has no device with Service Tag "${deviceRef}"`);
  }

  const subHealth = await http.tryGet<OmeCollection<{ SubSystems?: OmeSubSystem[] }>>(
    `/api/DeviceService/Devices(${device.Id})/SubSystemHealth`,
  );
  const subSystems = subHealth?.value?.[0]?.SubSystems ?? [];

  const inventory = await http.tryGet<OmeCollection<OmeInventorySection>>(
    `/api/DeviceService/Devices(${device.Id})/InventoryDetails`,
  );
  const sections = inventory?.value ?? [];

  const disks: OmeDisk[] = [];
  const powerSupplies: OmePowerSupply[] = [];
  let biosVersion: string | undefined;

  for (const section of sections) {
    const type = section.InventoryType ?? "";
    const rows = section.InventoryInfo ?? [];
    if (DISK_TYPES.includes(type)) {
      disks.push(...rows.map(toDisk));
    } else if (PSU_TYPES.includes(type)) {
      powerSupplies.push(...rows.map(toPsu));
    } else if (BIOS_TYPES.includes(type)) {
      const bios = rows.find(
        (r) => (s(r, "ComponentType", "SoftwareType") ?? "").toUpperCase() === "BIOS",
      );
      if (bios) {
        biosVersion = s(bios, "Version");
      }
    }
  }

  return {
    ciCode,
    device,
    ...(subSystems.length ? { subSystems } : {}),
    ...(disks.length ? { disks } : {}),
    ...(powerSupplies.length ? { powerSupplies } : {}),
    ...(biosVersion ? { biosVersion } : {}),
    observedAt: now(),
  };
}
