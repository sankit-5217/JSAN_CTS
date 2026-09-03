import { StubWarrantyProvider } from "./stub-provider";

describe("StubWarrantyProvider", () => {
  const now = () => new Date("2026-09-03T00:00:00.000Z");

  it("supports any manufacturer (catch-all fallback)", () => {
    const p = new StubWarrantyProvider();
    expect(p.supports()).toBe(true);
  });

  it("is deterministic for a given vendor + service tag", async () => {
    const a = new StubWarrantyProvider({ now });
    const b = new StubWarrantyProvider({ now });
    const q = { vendor: "DELL", serialOrServiceTag: "ABC1234" };
    expect(await a.lookup(q)).toEqual(await b.lookup(q));
  });

  it("returns a normalized result with an ISO expiry and the provider name", async () => {
    const p = new StubWarrantyProvider({ now });
    const result = await p.lookup({ vendor: "HPE", serialOrServiceTag: "SN-0001" });
    expect(result.provider).toBe("stub");
    expect(["ACTIVE", "EXPIRED"]).toContain(result.status);
    expect(result.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(typeof result.coverageLevel).toBe("string");
  });

  it("dates ACTIVE results in the future and EXPIRED results in the past", async () => {
    const p = new StubWarrantyProvider({ now });
    // scan a spread of tags so both branches are exercised
    let sawActive = false;
    let sawExpired = false;
    for (let i = 0; i < 60; i += 1) {
      const r = await p.lookup({ vendor: "DELL", serialOrServiceTag: `TAG-${i}` });
      const ms = Date.parse(r.expiresAt as string);
      if (r.status === "ACTIVE") {
        sawActive = true;
        expect(ms).toBeGreaterThanOrEqual(now().getTime());
      } else {
        sawExpired = true;
        expect(ms).toBeLessThan(now().getTime());
      }
    }
    expect(sawActive).toBe(true);
    expect(sawExpired).toBe(true);
  });
});
