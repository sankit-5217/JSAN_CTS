import type { RedfishSystemBundle } from "@cts-dc-opsdesk/redfish-adapter";
import type { MgmtHttp } from "./mgmt-http";

/**
 * Assemble a {@link RedfishSystemBundle} for the first ComputerSystem an
 * endpoint exposes. Read-only, best-effort: the System resource is required;
 * Thermal / Power are fetched from the first Chassis if present and skipped on
 * 404 (the redfish-adapter tolerates a partial bundle). Drive enumeration
 * (Systems -> Storage -> Drives) is a later addition.
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

  return {
    ciCode,
    system,
    ...(thermal ? { thermal } : {}),
    ...(power ? { power } : {}),
    observedAt: now(),
  };
}
