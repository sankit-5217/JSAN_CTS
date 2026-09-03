import type { BufferedItem } from "../delivery-buffer";
import type { EndpointTarget } from "../config";
import type { CredentialResolver } from "./credentials";
import { runHealthPoll } from "./health-poll";
import type { MgmtHttp } from "./mgmt-http";

const HEALTHY_SYSTEM = {
  Id: "1",
  Name: "srv",
  PowerState: "On",
  Status: { State: "Enabled", Health: "OK", HealthRollup: "OK" },
};

function httpFor(system: unknown): MgmtHttp {
  return {
    get: async (path: string) =>
      path === "/redfish/v1/Systems"
        ? { Members: [{ "@odata.id": "/redfish/v1/Systems/1" }] }
        : system,
    tryGet: async () => undefined, // no chassis
  } as unknown as MgmtHttp;
}

function httpForOme(): MgmtHttp {
  return {
    get: async (path: string) => {
      if (path.startsWith("/api/DeviceService/Devices?$filter")) {
        return {
          value: [{ Id: 10001, DeviceServiceTag: "SVCTAG1", Status: 1000, PowerState: 17 }],
        };
      }
      throw new Error(`unexpected OME GET ${path}`);
    },
    tryGet: async (path: string) =>
      path.endsWith("/SubSystemHealth")
        ? { value: [{ SubSystems: [{ Name: "Storage", Status: 1000 }] }] }
        : { value: [] },
  } as unknown as MgmtHttp;
}

const resolver: CredentialResolver = {
  resolve: (ref) => (ref === "missing" ? undefined : { username: "u", password: "p" }),
};

function endpoint(over: Partial<EndpointTarget> = {}): EndpointTarget {
  return {
    ciCode: "SITE01-R01-SRV-040",
    kind: "REDFISH",
    address: "https://10.20.1.40",
    credentialRef: "cred",
    ...over,
  };
}

function collector() {
  const enqueued: Array<Omit<BufferedItem, "queuedAt">> = [];
  return { enqueued, enqueue: (i: Omit<BufferedItem, "queuedAt">) => enqueued.push(i) };
}

describe("runHealthPoll", () => {
  it("fetches, normalizes and enqueues a health snapshot per Redfish endpoint", async () => {
    const { enqueued, enqueue } = collector();
    const result = await runHealthPoll({
      endpoints: [endpoint()],
      resolver,
      makeHttp: () => httpFor(HEALTHY_SYSTEM),
      enqueue,
      now: () => "2026-09-03T10:00:00.000Z",
    });

    expect(result).toEqual({ polled: 1, enqueued: 1, failed: [] });
    expect(enqueued[0].channel).toBe("health");
    expect(enqueued[0].key).toBe("health:SITE01-R01-SRV-040:2026-09-03T10:00:00.000Z");
    expect(enqueued[0].payload).toMatchObject({
      ciCode: "SITE01-R01-SRV-040",
      source: "REDFISH",
      overallHealth: "HEALTHY",
      powerState: "ON",
    });
  });

  it("uses the HPE adapter for an HPE_ILO endpoint", async () => {
    const { enqueued, enqueue } = collector();
    await runHealthPoll({
      endpoints: [endpoint({ kind: "HPE_ILO" })],
      resolver,
      makeHttp: () => httpFor(HEALTHY_SYSTEM),
      enqueue,
      now: () => "T",
    });
    expect(enqueued[0].payload).toMatchObject({ source: "HPE_ILO" });
  });

  it("fetches a DELL_OME device by Service Tag and normalizes via the OME adapter", async () => {
    const { enqueued, enqueue } = collector();
    const result = await runHealthPoll({
      endpoints: [endpoint({ ciCode: "OME-CI", kind: "DELL_OME", deviceRef: "SVCTAG1" })],
      resolver,
      makeHttp: () => httpForOme(),
      enqueue,
      now: () => "T",
    });

    expect(result).toEqual({ polled: 1, enqueued: 1, failed: [] });
    expect(enqueued[0].payload).toMatchObject({
      ciCode: "OME-CI",
      source: "DELL_OME",
      powerState: "ON",
    });
  });

  it("isolates per-endpoint failures — bad credential, unreachable host, OME with no deviceRef", async () => {
    const { enqueued, enqueue } = collector();
    const result = await runHealthPoll({
      endpoints: [
        endpoint({ ciCode: "NO-CRED", credentialRef: "missing" }),
        endpoint({ ciCode: "NO-REF", kind: "DELL_OME" }),
        endpoint({ ciCode: "BOOM", address: "https://boom" }),
      ],
      resolver,
      makeHttp: (baseUrl: string) => {
        if (baseUrl === "https://boom") {
          return {
            get: async () => {
              throw new Error("ECONNREFUSED");
            },
            tryGet: async () => undefined,
          } as unknown as MgmtHttp;
        }
        return httpFor(HEALTHY_SYSTEM);
      },
      enqueue,
    });

    expect(result.enqueued).toBe(0);
    expect(result.failed).toEqual([
      { ciCode: "NO-CRED", reason: 'no credential for "missing"' },
      { ciCode: "NO-REF", reason: "DELL_OME endpoint has no deviceRef" },
      { ciCode: "BOOM", reason: "ECONNREFUSED" },
    ]);
    expect(enqueued).toHaveLength(0);
  });
});
