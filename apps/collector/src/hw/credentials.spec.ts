import { EnvCredentialResolver } from "./credentials";

describe("EnvCredentialResolver", () => {
  it("resolves COLLECTOR_CRED_<REF> = user:pass", () => {
    const r = new EnvCredentialResolver({ COLLECTOR_CRED_IDRAC_40: "root:calvin" });
    expect(r.resolve("idrac-40")).toEqual({ username: "root", password: "calvin" });
  });

  it("keeps colons in the password (only the first splits)", () => {
    const r = new EnvCredentialResolver({ COLLECTOR_CRED_X: "admin:p:a:ss" });
    expect(r.resolve("x")).toEqual({ username: "admin", password: "p:a:ss" });
  });

  it("returns undefined for a missing or malformed entry", () => {
    const r = new EnvCredentialResolver({ COLLECTOR_CRED_Y: "nocolon" });
    expect(r.resolve("missing")).toBeUndefined();
    expect(r.resolve("y")).toBeUndefined();
  });
});
