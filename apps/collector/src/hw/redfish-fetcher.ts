import type { RedfishDrive, RedfishSystemBundle } from "@cts-dc-opsdesk/redfish-adapter";
import type { MgmtHttp } from "./mgmt-http";

/** Upper bound on drive GETs per poll, so a huge JBOD can't make one poll
 *  hammer a BMC. Drives past this are left out of that poll. */
export const MAX_DRIVES_PER_POLL = 64;

type Link = { "@odata.id"?: string };

/**
 * Every drive behind the system's storage controllers:
 * System.Storage -> each Storage member -> each of its Drives links.
 * Sequential GETs (BMCs handle concurrency badly), capped at
 * {@link MAX_DRIVES_PER_POLL}. Best-effort: returns undefined when the
 * system has no Storage collection or anything along the way fails, so a
 * storage hiccup never costs the rest of the health reading.
 */
async function fetchDrives(
  http: MgmtHttp,
  systemPath: string,
  system: RedfishSystemBundle["system"],
): Promise<RedfishDrive[] | undefined> {
  try {
    const storagePath = system.Storage?.["@odata.id"] ?? `${systemPath}/Storage`;
    const storageSet = await http.tryGet<{ Members?: Link[] }>(storagePath);
    if (!storageSet) {
      return undefined;
    }
    const drives: RedfishDrive[] = [];
    for (const member of storageSet.Members ?? []) {
      const controllerPath = member["@odata.id"];
      if (!controllerPath) continue;
      const controller = await http.tryGet<{ Drives?: Link[] }>(controllerPath);
      for (const link of controller?.Drives ?? []) {
        if (drives.length >= MAX_DRIVES_PER_POLL) {
          return drives;
        }
        const drivePath = link["@odata.id"];
        if (!drivePath) continue;
        const drive = await http.tryGet<RedfishDrive>(drivePath);
        if (drive) {
          drives.push(drive);
        }
      }
    }
    return drives;
  } catch {
    return undefined;
  }
}

/**
 * Assemble a {@link RedfishSystemBundle} for the first ComputerSystem an
 * endpoint exposes. Read-only, best-effort: the System resource is required;
 * Thermal / Power are fetched from the first Chassis if present and skipped on
 * 404, and drives come from the system's Storage controllers (see
 * fetchDrives). The redfish-adapter tolerates a partial bundle.
 *
 * Works for HPE iLO too — `Oem.Hpe` is returned inline on the System resource,
 * so the caller can hand the same bundle to `normalizeHpeIloSystem`.
 */
export async function fetchRedfishBundle(
  http: MgmtHttp,
  ciCode: string,
  now: () => string = () => new Date().toISOString(),
): Promise<RedfishSystemBundle> {
  const systems = await http.get<{ Members?: Array<{ "@odata.id": string }> }>(
    "/redfish/v1/Systems",
  );
  const systemPath = systems.Members?.[0]?.["@odata.id"];
  if (!systemPath) {
    throw new Error("Redfish endpoint exposes no ComputerSystem");
  }
  const system = await http.get<RedfishSystemBundle["system"]>(systemPath);

  const chassisSet = await http.tryGet<{ Members?: Array<{ "@odata.id": string }> }>(
    "/redfish/v1/Chassis",
  );
  const chassisPath = chassisSet?.Members?.[0]?.["@odata.id"];

  const thermal = chassisPath
    ? await http.tryGet<RedfishSystemBundle["thermal"]>(`${chassisPath}/Thermal`)
    : undefined;
  const power = chassisPath
    ? await http.tryGet<RedfishSystemBundle["power"]>(`${chassisPath}/Power`)
    : undefined;
  const drives = await fetchDrives(http, systemPath, system);

  return {
    ciCode,
    system,
    ...(thermal ? { thermal } : {}),
    ...(power ? { power } : {}),
    ...(drives ? { drives } : {}),
    observedAt: now(),
  };
}
