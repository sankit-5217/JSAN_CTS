import { JwtService } from "@nestjs/jwt";
import { Request, Response } from "express";
import { AuthService } from "./auth.service";
import { OIDC_TX_COOKIE, OidcController } from "./oidc.controller";
import { OidcClientService } from "./oidc/oidc-client.service";
import { SsoLoginRejectedError, SsoService } from "./sso.service";

const WEB = "http://localhost:5173";
const TX = { state: "state-1", nonce: "nonce-1", codeVerifier: "verifier-1" };

function makeController(enabled = true) {
  const jwt = new JwtService({ secret: "test-secret" });
  const oidc = {
    enabled,
    config: { webAppUrl: WEB, redirectUri: "https://api.example.com/api/v1/auth/oidc/callback" },
    startLogin: jest.fn().mockResolvedValue({ url: "https://idp.example.com/auth?x=1", tx: TX }),
    completeLogin: jest.fn().mockResolvedValue({ issuer: "iss", subject: "sub" }),
    logoutUrl: jest.fn().mockResolvedValue("https://idp.example.com/logout"),
  } as unknown as OidcClientService;
  const sso = {
    resolveUser: jest.fn().mockResolvedValue({ id: "user-1" }),
    createLoginCode: jest.fn().mockResolvedValue("one-time-code"),
    redeemLoginCode: jest.fn().mockResolvedValue({ id: "user-1" }),
  } as unknown as SsoService;
  const authService = {
    issueToken: jest.fn().mockReturnValue({ accessToken: "app-jwt", expiresIn: "12h" }),
  } as unknown as AuthService;
  return { controller: new OidcController(oidc, sso, authService, jwt), jwt, oidc, sso };
}

function makeRes() {
  const res = { cookie: jest.fn(), clearCookie: jest.fn(), redirect: jest.fn() };
  return res as unknown as Response & typeof res;
}

const reqWithCookie = (value?: string) =>
  ({ headers: value ? { cookie: `other=1; ${OIDC_TX_COOKIE}=${value}` } : {} }) as Request;

describe("OidcController", () => {
  it("login: sets a signed, httpOnly transaction cookie and redirects to the IdP", async () => {
    const { controller, jwt } = makeController();
    const res = makeRes();
    await controller.login(res);

    expect(res.redirect).toHaveBeenCalledWith(302, "https://idp.example.com/auth?x=1");
    const [name, value, options] = res.cookie.mock.calls[0];
    expect(name).toBe(OIDC_TX_COOKIE);
    expect(options).toMatchObject({ httpOnly: true, sameSite: "lax", secure: true });
    expect(jwt.verify(value, { audience: "opsdesk-oidc-tx" })).toMatchObject(TX);
  });

  it("login: bounces back to the login page when SSO is disabled", async () => {
    const { controller } = makeController(false);
    const res = makeRes();
    await controller.login(res);
    expect(res.redirect).toHaveBeenCalledWith(302, `${WEB}/login?sso_error=sso_disabled`);
  });

  it("callback: happy path hands the web app a one-time code in the fragment", async () => {
    const { controller, jwt, oidc, sso } = makeController();
    const cookie = jwt.sign({ ...TX }, { audience: "opsdesk-oidc-tx", expiresIn: 600 });
    const res = makeRes();

    await controller.callback(
      { code: "idp-code", state: "state-1" },
      reqWithCookie(cookie),
      res,
      "corr",
    );

    expect(oidc.completeLogin).toHaveBeenCalledWith({ code: "idp-code", state: "state-1" }, TX);
    expect(sso.resolveUser).toHaveBeenCalledWith({ issuer: "iss", subject: "sub" }, "corr");
    expect(res.clearCookie).toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith(302, `${WEB}/auth/callback#code=one-time-code`);
  });

  it("callback: rejects a state that doesn't match the cookie (login CSRF)", async () => {
    const { controller, jwt, oidc } = makeController();
    const cookie = jwt.sign({ ...TX }, { audience: "opsdesk-oidc-tx", expiresIn: 600 });
    const res = makeRes();

    await controller.callback({ code: "c", state: "attacker-state" }, reqWithCookie(cookie), res);

    expect(oidc.completeLogin).not.toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith(302, `${WEB}/login?sso_error=invalid_state`);
  });

  it("callback: rejects a missing or wrongly-signed transaction cookie", async () => {
    const { controller, oidc } = makeController();
    const forged = new JwtService({ secret: "other" }).sign(
      { ...TX },
      { audience: "opsdesk-oidc-tx" },
    );
    for (const req of [reqWithCookie(), reqWithCookie(forged)]) {
      const res = makeRes();
      await controller.callback({ code: "c", state: "state-1" }, req, res);
      expect(res.redirect).toHaveBeenCalledWith(302, `${WEB}/login?sso_error=invalid_state`);
    }
    expect(oidc.completeLogin).not.toHaveBeenCalled();
  });

  it("callback: an IdP error (e.g. user cancelled) goes back to login", async () => {
    const { controller } = makeController();
    const res = makeRes();
    await controller.callback({ error: "access_denied" }, reqWithCookie(), res);
    expect(res.redirect).toHaveBeenCalledWith(302, `${WEB}/login?sso_error=idp_error`);
  });

  it("callback: surfaces the rejection reason for an unprovisioned user, and a generic one otherwise", async () => {
    const { controller, jwt, sso, oidc } = makeController();
    const cookie = () => jwt.sign({ ...TX }, { audience: "opsdesk-oidc-tx", expiresIn: 600 });

    (sso.resolveUser as jest.Mock).mockRejectedValueOnce(
      new SsoLoginRejectedError("not_provisioned", "x"),
    );
    let res = makeRes();
    await controller.callback({ code: "c", state: "state-1" }, reqWithCookie(cookie()), res);
    expect(res.redirect).toHaveBeenCalledWith(302, `${WEB}/login?sso_error=not_provisioned`);

    (oidc.completeLogin as jest.Mock).mockRejectedValueOnce(new Error("nonce mismatch"));
    res = makeRes();
    await controller.callback({ code: "c", state: "state-1" }, reqWithCookie(cookie()), res);
    expect(res.redirect).toHaveBeenCalledWith(302, `${WEB}/login?sso_error=login_failed`);
  });

  it("exchange: trades a redeemed code for the app token", async () => {
    const { controller, sso } = makeController();
    await expect(controller.exchange({ code: "one-time-code" })).resolves.toEqual({
      accessToken: "app-jwt",
      expiresIn: "12h",
    });
    expect(sso.redeemLoginCode).toHaveBeenCalledWith("one-time-code");
  });

  it("logout: redirects to the IdP's end-session URL, or the login page without SSO", async () => {
    let res = makeRes();
    await makeController().controller.logout(res);
    expect(res.redirect).toHaveBeenCalledWith(302, "https://idp.example.com/logout");

    res = makeRes();
    await makeController(false).controller.logout(res);
    expect(res.redirect).toHaveBeenCalledWith(302, `${WEB}/login`);
  });
});
