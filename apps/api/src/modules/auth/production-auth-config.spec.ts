import { findProductionAuthConfigProblems } from "./production-auth-config";

const GOOD = {
  JWT_SECRET: "k3v9Qm2xT8wLr5Zp7yNc4Hb6Jd1Fg0Sa",
  OIDC_ENABLED: "true",
  OIDC_ISSUER_URL: "https://sso.jsan.example/realms/opsdesk",
  OIDC_CLIENT_SECRET: "a-real-random-client-secret-from-keycloak",
  OIDC_REDIRECT_URI: "https://opsdesk.jsan.example/api/v1/auth/oidc/callback",
  WEB_APP_URL: "https://opsdesk.jsan.example",
};

describe("findProductionAuthConfigProblems", () => {
  it("passes a correct production configuration", () => {
    expect(findProductionAuthConfigProblems(GOOD)).toEqual({ errors: [], warnings: [] });
  });

  it.each([
    [undefined, /not set/],
    ["change-me-dev-only", /placeholder/],
    ["CHANGE-ME", /placeholder/],
    ["short-but-random", /at least 32/],
  ])("rejects JWT_SECRET=%s", (value, message) => {
    const { errors } = findProductionAuthConfigProblems({ ...GOOD, JWT_SECRET: value });
    expect(errors).toEqual([expect.stringMatching(message)]);
  });

  it("rejects the dev realm's client secret", () => {
    const { errors } = findProductionAuthConfigProblems({
      ...GOOD,
      OIDC_CLIENT_SECRET: "change-me",
    });
    expect(errors).toEqual([expect.stringContaining("OIDC_CLIENT_SECRET")]);
  });

  it("only warns about an empty client secret (public client)", () => {
    const result = findProductionAuthConfigProblems({ ...GOOD, OIDC_CLIENT_SECRET: "" });
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([expect.stringContaining("public OIDC client")]);
  });

  it("requires https, non-localhost addresses for the IdP, callback and web app", () => {
    const { errors } = findProductionAuthConfigProblems({
      ...GOOD,
      OIDC_ISSUER_URL: "http://localhost:8080/realms/opsdesk",
      OIDC_REDIRECT_URI: "https://127.0.0.1:3000/api/v1/auth/oidc/callback",
      WEB_APP_URL: undefined,
    });
    expect(errors).toEqual([
      expect.stringContaining("OIDC_ISSUER_URL must use https://"),
      expect.stringContaining("OIDC_REDIRECT_URI points at localhost"),
      "WEB_APP_URL is not set",
    ]);
  });

  it("warns (doesn't fail) when SSO is off, and skips the OIDC checks", () => {
    const result = findProductionAuthConfigProblems({ JWT_SECRET: GOOD.JWT_SECRET });
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([expect.stringContaining("no person can sign in")]);
  });
});
