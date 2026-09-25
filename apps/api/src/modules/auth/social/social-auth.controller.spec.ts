import { JwtService } from "@nestjs/jwt";
import { Request, Response } from "express";
import { AuthService } from "../auth.service";
import { SOCIAL_TX_COOKIE, SocialAuthController } from "./social-auth.controller";
import { SocialIdentityService, SocialLoginRejectedError } from "./social-identity.service";
import { SocialProvidersService } from "./social-providers.service";

const WEB = "http://localhost:5173";
const TX = { provider: "google", state: "state-1", nonce: "nonce-1", codeVerifier: "v-1" };

function makeController(opts: { providerEnabled?: boolean; https?: boolean } = {}) {
  const jwt = new JwtService({ secret: "test-secret" });
  const client = {
    id: "google",
    label: "Google",
    startLogin: jest.fn().mockResolvedValue({ url: "https://accounts.google.com/o?x=1", tx: TX }),
    completeLogin: jest.fn().mockResolvedValue({ provider: "google", issuer: "iss", subject: "s" }),
  };
  const providers = {
    config: {
      webAppUrl: WEB,
      apiPublicUrl: opts.https === false ? "http://localhost:3000" : "https://api.example.com",
    },
    get: jest.fn((id: string) =>
      opts.providerEnabled === false || id !== "google" ? undefined : client,
    ),
  } as unknown as SocialProvidersService;
  const identities = {
    resolveUser: jest.fn().mockResolvedValue({ id: "user-1" }),
    createHandoffCode: jest.fn().mockResolvedValue("one-time-code"),
    redeemHandoffCode: jest.fn().mockResolvedValue({ id: "user-1" }),
  } as unknown as SocialIdentityService;
  const authService = {
    issueToken: jest.fn().mockReturnValue({ accessToken: "app-jwt", expiresIn: "12h" }),
  } as unknown as AuthService;
  return {
    controller: new SocialAuthController(providers, identities, authService, jwt),
    jwt,
    client,
    identities,
  };
}

function makeRes() {
  const res = { cookie: jest.fn(), clearCookie: jest.fn(), redirect: jest.fn() };
  return res as unknown as Response & typeof res;
}

const reqWithCookie = (value?: string) =>
  ({ headers: value ? { cookie: `other=1; ${SOCIAL_TX_COOKIE}=${value}` } : {} }) as Request;

const signTx = (jwt: JwtService, tx: object = TX) =>
  jwt.sign({ ...tx }, { audience: "opsdesk-social-tx", expiresIn: 600 });

describe("SocialAuthController", () => {
  it("login: sets a signed httpOnly cookie and redirects to the provider", async () => {
    const { controller, jwt } = makeController();
    const res = makeRes();
    await controller.login("google", res);
    expect(res.redirect).toHaveBeenCalledWith(302, "https://accounts.google.com/o?x=1");
    const [name, value, options] = res.cookie.mock.calls[0];
    expect(name).toBe(SOCIAL_TX_COOKIE);
    expect(options).toMatchObject({ httpOnly: true, sameSite: "lax", secure: true });
    expect(jwt.verify(value, { audience: "opsdesk-social-tx" })).toMatchObject(TX);
  });

  it("login: the cookie isn't Secure-only on a plain-http local API", async () => {
    const { controller } = makeController({ https: false });
    const res = makeRes();
    await controller.login("google", res);
    expect(res.cookie.mock.calls[0][2]).toMatchObject({ secure: false });
  });

  it("login: unknown or unconfigured provider bounces back to the login page", async () => {
    const { controller } = makeController();
    const res = makeRes();
    await controller.login("apple", res);
    expect(res.redirect).toHaveBeenCalledWith(302, `${WEB}/login?social_error=provider_disabled`);
  });

  it("callback: happy path hands the web app a one-time code in the fragment", async () => {
    const { controller, jwt, client, identities } = makeController();
    const res = makeRes();
    await controller.callback(
      "google",
      { code: "c", state: "state-1" },
      reqWithCookie(signTx(jwt)),
      res,
      "corr",
    );
    expect(client.completeLogin).toHaveBeenCalledWith({ code: "c", state: "state-1" }, TX);
    expect(identities.resolveUser).toHaveBeenCalledWith(
      { provider: "google", issuer: "iss", subject: "s" },
      "corr",
    );
    expect(res.clearCookie).toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith(302, `${WEB}/auth/callback#code=one-time-code`);
  });

  it("callback: rejects a state mismatch, a forged cookie, or a cookie from another provider", async () => {
    const { controller, jwt, client } = makeController();
    const forged = new JwtService({ secret: "other" }).sign(
      { ...TX },
      { audience: "opsdesk-social-tx" },
    );
    const cases: [Record<string, string>, Request][] = [
      [{ code: "c", state: "attacker" }, reqWithCookie(signTx(jwt))],
      [{ code: "c", state: "state-1" }, reqWithCookie(forged)],
      [{ code: "c", state: "state-1" }, reqWithCookie()],
      [{ code: "c", state: "state-1" }, reqWithCookie(signTx(jwt, { ...TX, provider: "github" }))],
    ];
    for (const [query, req] of cases) {
      const res = makeRes();
      await controller.callback("google", query, req, res);
      expect(res.redirect).toHaveBeenCalledWith(302, `${WEB}/login?social_error=invalid_state`);
    }
    expect(client.completeLogin).not.toHaveBeenCalled();
  });

  it("callback: provider error (user cancelled) goes back to login", async () => {
    const { controller } = makeController();
    const res = makeRes();
    await controller.callback("google", { error: "access_denied" }, reqWithCookie(), res);
    expect(res.redirect).toHaveBeenCalledWith(302, `${WEB}/login?social_error=provider_error`);
  });

  it("callback: surfaces a rejection reason, and a generic one for anything else", async () => {
    const { controller, jwt, identities, client } = makeController();
    (identities.resolveUser as jest.Mock).mockRejectedValueOnce(
      new SocialLoginRejectedError("not_provisioned", "x"),
    );
    let res = makeRes();
    await controller.callback(
      "google",
      { code: "c", state: "state-1" },
      reqWithCookie(signTx(jwt)),
      res,
    );
    expect(res.redirect).toHaveBeenCalledWith(302, `${WEB}/login?social_error=not_provisioned`);

    client.completeLogin.mockRejectedValueOnce(new Error("nonce mismatch"));
    res = makeRes();
    await controller.callback(
      "google",
      { code: "c", state: "state-1" },
      reqWithCookie(signTx(jwt)),
      res,
    );
    expect(res.redirect).toHaveBeenCalledWith(302, `${WEB}/login?social_error=login_failed`);
  });

  it("exchange: trades a redeemed code for the app token", async () => {
    const { controller, identities } = makeController();
    await expect(controller.exchange({ code: "one-time-code" })).resolves.toEqual({
      accessToken: "app-jwt",
      expiresIn: "12h",
    });
    expect(identities.redeemHandoffCode).toHaveBeenCalledWith("one-time-code");
  });
});
