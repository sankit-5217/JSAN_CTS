import { allowedCorsOrigins, apiDocsEnabled, listenPort } from "./deploy-config";
import { callerKey } from "./throttling";

describe("deploy config", () => {
  it("listens on Railway's PORT first, then API_PORT, then 3000", () => {
    expect(listenPort({ PORT: "8080", API_PORT: "3000" })).toBe(8080);
    expect(listenPort({ API_PORT: "3100" })).toBe(3100);
    expect(listenPort({})).toBe(3000);
    expect(listenPort({ PORT: "nope" })).toBe(3000);
  });

  it("limits CORS to the web app in production", () => {
    expect(
      allowedCorsOrigins({ NODE_ENV: "production", WEB_APP_URL: "https://desk.example.com/" }),
    ).toEqual(["https://desk.example.com"]);
    expect(
      allowedCorsOrigins({ API_CORS_ORIGIN: "https://a.example.com, https://b.example.com" }),
    ).toEqual(["https://a.example.com", "https://b.example.com"]);
    expect(allowedCorsOrigins({ NODE_ENV: "production" })).toEqual([]);
    expect(allowedCorsOrigins({})).toBeNull();
  });

  it("hides the API docs in production unless switched on", () => {
    expect(apiDocsEnabled({ NODE_ENV: "production" })).toBe(false);
    expect(apiDocsEnabled({ NODE_ENV: "production", API_DOCS_ENABLED: "true" })).toBe(true);
    expect(apiDocsEnabled({})).toBe(true);
  });
});

describe("rate-limit caller key", () => {
  it("keys a signed-in caller by a hash of their token, never the token", () => {
    const key = callerKey({ headers: { authorization: "Bearer secret-token" }, ip: "1.2.3.4" });
    expect(key).toMatch(/^tok:[0-9a-f]{32}$/);
    expect(key).not.toContain("secret-token");
  });

  it("falls back to the client IP", () => {
    expect(callerKey({ headers: {}, ip: "1.2.3.4" })).toBe("ip:1.2.3.4");
  });
});
