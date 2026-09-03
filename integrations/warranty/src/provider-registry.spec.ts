import { createWarrantyProviders, resolveWarrantyProvider } from "./provider-registry";
import { StubWarrantyProvider } from "./stub-provider";
import type { WarrantyProvider } from "./types";

const fake = (name: string, vendor: string): WarrantyProvider => ({
  name,
  supports: (v) => v.toUpperCase() === vendor,
  lookup: async () => ({ status: "UNKNOWN", provider: name }),
});

describe("resolveWarrantyProvider", () => {
  it("returns the first provider that claims the vendor", () => {
    const providers = [fake("dell", "DELL"), fake("hpe", "HPE"), new StubWarrantyProvider()];
    expect(resolveWarrantyProvider(providers, "DELL")?.name).toBe("dell");
    expect(resolveWarrantyProvider(providers, "HPE")?.name).toBe("hpe");
    // stub is a catch-all, so an unknown vendor still resolves to it here
    expect(resolveWarrantyProvider(providers, "SUPERMICRO")?.name).toBe("stub");
  });

  it("returns undefined when nothing supports the vendor", () => {
    expect(resolveWarrantyProvider([fake("dell", "DELL")], "HPE")).toBeUndefined();
  });
});

describe("createWarrantyProviders", () => {
  it("builds an empty list when nothing is configured", () => {
    expect(createWarrantyProviders({})).toEqual([]);
  });

  it("adds the stub only when explicitly enabled, and always last", () => {
    const withStub = createWarrantyProviders({ dellApiKey: "k", enableStub: true });
    expect(withStub.map((p) => p.name)).toEqual(["dell-techdirect", "stub"]);

    const noStub = createWarrantyProviders({ dellApiKey: "k" });
    expect(noStub.map((p) => p.name)).toEqual(["dell-techdirect"]);
  });

  it("registers Dell and HPE providers when their keys are present", () => {
    const providers = createWarrantyProviders({ dellApiKey: "d", hpeApiKey: "h" });
    expect(providers.map((p) => p.name)).toEqual(["dell-techdirect", "hpe-warranty"]);
  });
});
