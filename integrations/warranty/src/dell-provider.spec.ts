import { DellWarrantyProvider, normalizeDellWarranty } from "./dell-provider";
import { WarrantyProviderError } from "./errors";
import type { WarrantyFetch } from "./types";

const NOW = new Date("2026-09-03T00:00:00.000Z");

/** Trimmed shape of a real Dell asset-entitlements response. */
const FIXTURE = [
  {
    serviceTag: "ABC1234",
    entitlements: [
      {
        serviceLevelDescription: "Basic Hardware Service",
        startDate: "2021-05-01T00:00:00Z",
        endDate: "2024-05-01T00:00:00Z",
        entitlementType: "INITIAL",
      },
      {
        serviceLevelDescription: "ProSupport Plus",
        startDate: "2024-05-01T00:00:00Z",
        endDate: "2027-05-01T00:00:00Z",
        entitlementType: "EXTENDED",
      },
    ],
  },
];

function fakeFetch(status: number, body: unknown): { impl: WarrantyFetch; calls: string[] } {
  const calls: string[] = [];
  const impl: WarrantyFetch = async (url) => {
    calls.push(url);
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
    };
  };
  return { impl, calls };
}

describe("normalizeDellWarranty", () => {
  it("picks the entitlement with the latest end date and marks it ACTIVE when in future", () => {
    const r = normalizeDellWarranty(FIXTURE[0], "ABC1234", NOW);
    expect(r).toEqual({
      status: "ACTIVE",
      provider: "dell-techdirect",
      expiresAt: "2027-05-01T00:00:00.000Z",
      coverageLevel: "ProSupport Plus",
    });
  });

  it("marks EXPIRED when the latest end date is in the past", () => {
    const r = normalizeDellWarranty(
      { serviceTag: "OLD", entitlements: [{ endDate: "2020-01-01T00:00:00Z" }] },
      "OLD",
      NOW,
    );
    expect(r.status).toBe("EXPIRED");
    expect(r.expiresAt).toBe("2020-01-01T00:00:00.000Z");
  });

  it("returns UNKNOWN with no expiry when there are no dated entitlements", () => {
    expect(normalizeDellWarranty({ serviceTag: "X", entitlements: [] }, "X", NOW)).toEqual({
      status: "UNKNOWN",
      provider: "dell-techdirect",
    });
    expect(normalizeDellWarranty(undefined, "X", NOW)).toEqual({
      status: "UNKNOWN",
      provider: "dell-techdirect",
    });
  });
});

describe("DellWarrantyProvider", () => {
  it("requires an apiKey", () => {
    expect(() => new DellWarrantyProvider({ apiKey: "" })).toThrow(WarrantyProviderError);
  });

  it("only supports the DELL manufacturer", () => {
    const p = new DellWarrantyProvider({ apiKey: "k", fetchImpl: fakeFetch(200, []).impl });
    expect(p.supports("dell")).toBe(true);
    expect(p.supports(" DELL ")).toBe(true);
    expect(p.supports("HPE")).toBe(false);
  });

  it("calls the entitlements endpoint with the tag and bearer token, then normalizes", async () => {
    const { impl, calls } = fakeFetch(200, FIXTURE);
    const p = new DellWarrantyProvider({ apiKey: "secret", fetchImpl: impl, now: () => NOW });
    const r = await p.lookup({ vendor: "DELL", serialOrServiceTag: "ABC1234" });
    expect(calls[0]).toContain("/asset-entitlements?servicetags=ABC1234");
    expect(r.status).toBe("ACTIVE");
    expect(r.expiresAt).toBe("2027-05-01T00:00:00.000Z");
  });

  it("throws WarrantyProviderError carrying the status on a non-2xx response", async () => {
    const p = new DellWarrantyProvider({
      apiKey: "k",
      fetchImpl: fakeFetch(429, "slow down").impl,
    });
    await expect(p.lookup({ vendor: "DELL", serialOrServiceTag: "T" })).rejects.toMatchObject({
      name: "WarrantyProviderError",
      provider: "dell-techdirect",
      status: 429,
    });
  });

  it("throws on a non-JSON body", async () => {
    const p = new DellWarrantyProvider({ apiKey: "k", fetchImpl: fakeFetch(200, "<html>").impl });
    await expect(p.lookup({ vendor: "DELL", serialOrServiceTag: "T" })).rejects.toBeInstanceOf(
      WarrantyProviderError,
    );
  });

  it("rejects an empty service tag before making a request", async () => {
    const { impl, calls } = fakeFetch(200, []);
    const p = new DellWarrantyProvider({ apiKey: "k", fetchImpl: impl });
    await expect(p.lookup({ vendor: "DELL", serialOrServiceTag: "  " })).rejects.toBeInstanceOf(
      WarrantyProviderError,
    );
    expect(calls).toHaveLength(0);
  });
});
