import { ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Issuer } from "openid-client";
import { OidcClientService } from "./oidc-client.service";

jest.mock("openid-client", () => ({
  ...jest.requireActual("openid-client"),
  Issuer: { discover: jest.fn() },
}));

const ENV: Record<string, string> = {
  OIDC_ENABLED: "true",
  OIDC_ISSUER_URL: "https://idp.example.com",
  OIDC_CLIENT_ID: "opsdesk-web",
  OIDC_CLIENT_SECRET: "secret",
  OIDC_REDIRECT_URI: "https://api.example.com/api/v1/auth/oidc/callback",
};
const TX = { state: "s", nonce: "n", codeVerifier: "v" };

function makeService(env: Record<string, string> = ENV, client: Record<string, unknown> = {}) {
  const config = {
    get: jest.fn((key: string, fallback?: string) => env[key] ?? fallback),
  } as unknown as ConfigService;
  const fullClient = {
    issuer: { metadata: { userinfo_endpoint: "https://idp.example.com/userinfo" } },
    ...client,
  };
  (Issuer.discover as jest.Mock).mockResolvedValue({
    Client: jest.fn().mockImplementation(() => fullClient),
  });
  return { service: new OidcClientService(config), client: fullClient };
}

const tokenSet = (claims: Record<string, unknown>) => ({
  access_token: "at",
  claims: () => ({ iss: "https://idp.example.com", sub: "sub-1", ...claims }),
});

describe("OidcClientService", () => {
  beforeEach(() => jest.clearAllMocks());

  it("is disabled unless OIDC_ENABLED=true, and refuses to start a login", async () => {
    const { service } = makeService({ ...ENV, OIDC_ENABLED: "false" });
    expect(service.enabled).toBe(false);
    await expect(service.startLogin()).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(Issuer.discover).not.toHaveBeenCalled();
  });

  it("starts an S256 PKCE authorization request carrying state and nonce", async () => {
    const authorizationUrl = jest.fn().mockReturnValue("https://idp.example.com/auth?...");
    const { service } = makeService(ENV, { authorizationUrl });

    const { url, tx } = await service.startLogin();

    expect(url).toBe("https://idp.example.com/auth?...");
    expect(authorizationUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        state: tx.state,
        nonce: tx.nonce,
        code_challenge_method: "S256",
        scope: "openid email profile",
      }),
    );
    expect(authorizationUrl.mock.calls[0][0].code_challenge).not.toBe(tx.codeVerifier);
  });

  it("uses ID-token claims directly when they include the email", async () => {
    const userinfo = jest.fn();
    const callback = jest
      .fn()
      .mockResolvedValue(tokenSet({ email: "a@example.com", email_verified: true }));
    const { service } = makeService(ENV, { callback, userinfo });

    await expect(service.completeLogin({ code: "c", state: "s" }, TX)).resolves.toEqual({
      issuer: "https://idp.example.com",
      subject: "sub-1",
      email: "a@example.com",
      emailVerified: true,
      name: null,
    });
    expect(callback).toHaveBeenCalledWith(
      ENV.OIDC_REDIRECT_URI,
      { code: "c", state: "s" },
      { state: "s", nonce: "n", code_verifier: "v" },
    );
    expect(userinfo).not.toHaveBeenCalled();
  });

  it("falls back to userinfo when the ID token carries only sub, keeping iss/sub from the ID token", async () => {
    const userinfo = jest
      .fn()
      .mockResolvedValue({ sub: "sub-1", email: "b@example.com", name: "B", iss: "ignored" });
    const { service } = makeService(ENV, {
      callback: jest.fn().mockResolvedValue(tokenSet({})),
      userinfo,
    });

    await expect(service.completeLogin({}, TX)).resolves.toMatchObject({
      issuer: "https://idp.example.com",
      subject: "sub-1",
      email: "b@example.com",
      name: "B",
    });
  });

  it("retries discovery after a failure instead of caching the error", async () => {
    const { service } = makeService(ENV, { authorizationUrl: jest.fn().mockReturnValue("u") });
    (Issuer.discover as jest.Mock).mockRejectedValueOnce(new Error("ECONNREFUSED"));

    await expect(service.startLogin()).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(service.startLogin()).resolves.toMatchObject({ url: "u" });
    expect(Issuer.discover).toHaveBeenCalledTimes(2);
  });
});
