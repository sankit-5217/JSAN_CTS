import { WarrantyProviderError } from "./errors";
import { HpeWarrantyProvider, normalizeHpeWarranty } from "./hpe-provider";
import type { WarrantyFetch } from "./types";

const NOW = new Date("2026-09-03T00:00:00.000Z");

const FIXTURE = {
  products: [
    {
      serialNumber: "SGH1234ABC",
      productNumber: "P00924-B21",
      warrantyEndDate: "2025-01-01T00:00:00Z",
      offers: [
        { offerName: "Foundation Care 24x7", endDate: "2026-01-01T00:00:00Z" },
        { offerName: "Foundation Care 24x7 (renewal)", endDate: "2028-01-01T00:00:00Z" },
      ],
    },
  ],
};

function fakeFetch(status: number, body: unknown): { impl: WarrantyFetch; bodies: string[] } {
  const bodies: string[] = [];
  const impl: WarrantyFetch = async (_url, init) => {
    bodies.push(init.body ?? "");
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
    };
  };
  return { impl, bodies };
}

describe("normalizeHpeWarranty", () => {
  it("prefers the latest offer end date", () => {
    const r = normalizeHpeWarranty(FIXTURE.products[0], NOW);
    expect(r).toEqual({
      status: "ACTIVE",
      provider: "hpe-warranty",
      expiresAt: "2028-01-01T00:00:00.000Z",
      coverageLevel: "Foundation Care 24x7 (renewal)",
    });
  });

  it("falls back to product-level warrantyEndDate when there are no offers", () => {
    const r = normalizeHpeWarranty(
      { serialNumber: "S", warrantyEndDate: "2024-06-01T00:00:00Z", offers: [] },
      NOW,
    );
    expect(r.status).toBe("EXPIRED");
    expect(r.expiresAt).toBe("2024-06-01T00:00:00.000Z");
  });

  it("returns UNKNOWN when nothing is dated", () => {
    expect(normalizeHpeWarranty(undefined, NOW)).toEqual({
      status: "UNKNOWN",
      provider: "hpe-warranty",
    });
  });
});

describe("HpeWarrantyProvider", () => {
  it("requires an apiKey", () => {
    expect(() => new HpeWarrantyProvider({ apiKey: "" })).toThrow(WarrantyProviderError);
  });

  it("supports HPE/HP manufacturer spellings only", () => {
    const p = new HpeWarrantyProvider({ apiKey: "k", fetchImpl: fakeFetch(200, {}).impl });
    expect(p.supports("HPE")).toBe(true);
    expect(p.supports("hp")).toBe(true);
    expect(p.supports("Hewlett Packard Enterprise")).toBe(true);
    expect(p.supports("DELL")).toBe(false);
  });

  it("posts the serial number and normalizes the response", async () => {
    const { impl, bodies } = fakeFetch(200, FIXTURE);
    const p = new HpeWarrantyProvider({ apiKey: "k", fetchImpl: impl, now: () => NOW });
    const r = await p.lookup({ vendor: "HPE", serialOrServiceTag: "SGH1234ABC" });
    expect(JSON.parse(bodies[0])).toEqual({ serialNumber: "SGH1234ABC" });
    expect(r.status).toBe("ACTIVE");
    expect(r.expiresAt).toBe("2028-01-01T00:00:00.000Z");
  });

  it("throws WarrantyProviderError on a non-2xx response", async () => {
    const p = new HpeWarrantyProvider({ apiKey: "k", fetchImpl: fakeFetch(503, "down").impl });
    await expect(p.lookup({ vendor: "HPE", serialOrServiceTag: "S" })).rejects.toMatchObject({
      provider: "hpe-warranty",
      status: 503,
    });
  });
});
