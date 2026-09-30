import { findProductionAuthConfigProblems } from "./production-auth-config";

const GOOD = {
  JWT_SECRET: "k3v9Qm2xT8wLr5Zp7yNc4Hb6Jd1Fg0Sa",
  WEB_APP_URL: "https://opsdesk.jsan.example",
  API_PUBLIC_URL: "https://opsdesk.jsan.example",
  REDIS_URL: "redis://redis:6379",
  GOOGLE_CLIENT_SECRET: "GOCSPX-real-looking-secret",
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

  it("requires https, non-localhost web and API addresses", () => {
    const { errors } = findProductionAuthConfigProblems({
      ...GOOD,
      WEB_APP_URL: "http://localhost:5173",
      API_PUBLIC_URL: "https://127.0.0.1:3000",
    });
    expect(errors).toEqual([
      expect.stringContaining("WEB_APP_URL must use https://"),
      expect.stringContaining("API_PUBLIC_URL points at localhost"),
    ]);
    expect(findProductionAuthConfigProblems({ ...GOOD, API_PUBLIC_URL: undefined }).errors).toEqual(
      ["API_PUBLIC_URL is not set"],
    );
  });

  it("rejects placeholder provider secrets", () => {
    const { errors } = findProductionAuthConfigProblems({
      ...GOOD,
      GITHUB_CLIENT_SECRET: "change-me",
    });
    expect(errors).toEqual([expect.stringContaining("GITHUB_CLIENT_SECRET")]);
  });

  it("warns (doesn't fail) without Redis", () => {
    const result = findProductionAuthConfigProblems({ ...GOOD, REDIS_URL: undefined });
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([expect.stringContaining("copy links by hand")]);
  });
});
