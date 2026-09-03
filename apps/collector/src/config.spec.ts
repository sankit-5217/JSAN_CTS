import { CollectorConfigError, loadConfig } from "./config";

function raw(overrides: Record<string, unknown> = {}) {
  return {
    siteCode: "SITE01",
    apiBaseUrl: "https://opsdesk.jsan.example/api/v1",
    apiToken: "svc-token",
    endpoints: [
      {
        ciCode: "SITE01-R01-SRV-040",
        kind: "REDFISH",
        address: "https://10.20.1.40",
        credentialRef: "idrac-40",
      },
    ],
    ...overrides,
  };
}

describe("loadConfig", () => {
  it("parses a valid config and applies interval defaults", () => {
    const cfg = loadConfig(raw());
    expect(cfg.siteCode).toBe("SITE01");
    expect(cfg.pollIntervalSeconds).toBe(300);
    expect(cfg.heartbeatIntervalSeconds).toBe(60);
    expect(cfg.bufferMaxItems).toBe(10_000);
    expect(cfg.endpoints).toHaveLength(1);
    expect(cfg.endpoints[0]).toEqual({
      ciCode: "SITE01-R01-SRV-040",
      kind: "REDFISH",
      address: "https://10.20.1.40",
      credentialRef: "idrac-40",
    });
  });

  it("rejects a non-https apiBaseUrl (outbound TLS only)", () => {
    try {
      loadConfig(raw({ apiBaseUrl: "http://opsdesk.jsan.example/api/v1" }));
      throw new Error("expected loadConfig to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(CollectorConfigError);
      expect((err as CollectorConfigError).field).toBe("apiBaseUrl");
    }
  });

  it("rejects an empty endpoints array", () => {
    expect(() => loadConfig(raw({ endpoints: [] }))).toThrow(CollectorConfigError);
  });

  it("rejects an unknown endpoint kind", () => {
    const bad = raw({
      endpoints: [{ ciCode: "C", kind: "IPMI", address: "https://x", credentialRef: "r" }],
    });
    try {
      loadConfig(bad);
      throw new Error("expected loadConfig to throw");
    } catch (err) {
      expect((err as CollectorConfigError).field).toBe("endpoints[0].kind");
    }
  });

  it("rejects a non-positive interval", () => {
    expect(() => loadConfig(raw({ pollIntervalSeconds: 0 }))).toThrow(CollectorConfigError);
    expect(() => loadConfig(raw({ pollIntervalSeconds: -5 }))).toThrow(CollectorConfigError);
  });

  it("rejects a missing required field", () => {
    const noSite = raw();
    delete (noSite as Record<string, unknown>).siteCode;
    expect(() => loadConfig(noSite)).toThrow(CollectorConfigError);
  });
});
