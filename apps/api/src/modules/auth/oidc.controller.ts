import { Body, Controller, Get, Logger, Post, Query, Req, Res } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { Request, Response } from "express";
import { CorrelationId } from "../../common/decorators/correlation-id.decorator";
import { AuthService } from "./auth.service";
import { SsoExchangeDto } from "./dto/sso-exchange.dto";
import { OidcClientService, OidcTransaction } from "./oidc/oidc-client.service";
import { SsoLoginRejectedError, SsoService } from "./sso.service";

/** httpOnly cookie carrying state/nonce/PKCE verifier from /login to /callback. */
export const OIDC_TX_COOKIE = "opsdesk_oidc_tx";
const OIDC_TX_AUDIENCE = "opsdesk-oidc-tx";
const OIDC_TX_TTL_SECONDS = 600;

/**
 * Real SSO (spec §7, §17): backend authorization-code flow with PKCE.
 *
 *   GET  /auth/oidc/login     -> 302 to the IdP (state/nonce/verifier in a signed cookie)
 *   GET  /auth/oidc/callback  -> verifies the ID token, maps it to a
 *                                pre-provisioned user, 302 to the web app with
 *                                a 60s single-use code in the URL fragment
 *   POST /auth/oidc/exchange  -> code -> the same app JWT dev-login issues
 *   GET  /auth/oidc/logout    -> 302 to the IdP's end-session endpoint
 *
 * The IdP's tokens never reach the browser; the client secret stays here.
 * Everything downstream (JwtStrategy, RolesGuard, SiteScopeGuard) is unchanged.
 */
@ApiTags("auth")
@Controller("auth/oidc")
export class OidcController {
  private readonly logger = new Logger(OidcController.name);

  constructor(
    private readonly oidc: OidcClientService,
    private readonly sso: SsoService,
    private readonly authService: AuthService,
    private readonly jwt: JwtService,
  ) {}

  @ApiOperation({ summary: "Start SSO login (browser redirect to the IdP)" })
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Get("login")
  async login(@Res() res: Response): Promise<void> {
    if (!this.oidc.enabled) return this.toLogin(res, "sso_disabled");
    try {
      const { url, tx } = await this.oidc.startLogin();
      res.cookie(
        OIDC_TX_COOKIE,
        this.jwt.sign(
          { ...tx },
          {
            audience: OIDC_TX_AUDIENCE,
            expiresIn: OIDC_TX_TTL_SECONDS,
          },
        ),
        this.cookieOptions(OIDC_TX_TTL_SECONDS * 1000),
      );
      res.redirect(302, url);
    } catch (err) {
      this.logger.error(`SSO login start failed: ${describe(err)}`);
      this.toLogin(res, "idp_unavailable");
    }
  }

  @ApiOperation({ summary: "IdP redirect target — not called directly" })
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Get("callback")
  async callback(
    @Query() query: Record<string, string>,
    @Req() req: Request,
    @Res() res: Response,
    @CorrelationId() correlationId?: string,
  ): Promise<void> {
    const tx = this.readTransaction(req);
    res.clearCookie(OIDC_TX_COOKIE, this.cookieOptions());

    if (query.error) {
      this.logger.warn(`IdP returned error on callback: ${query.error}`);
      return this.toLogin(res, "idp_error");
    }
    if (!tx || !query.state || query.state !== tx.state) {
      this.logger.warn("SSO callback with missing/expired transaction or state mismatch");
      return this.toLogin(res, "invalid_state");
    }

    try {
      const identity = await this.oidc.completeLogin(query, tx);
      const user = await this.sso.resolveUser(identity, correlationId);
      const code = await this.sso.createLoginCode(user.id);
      res.redirect(
        302,
        `${this.oidc.config.webAppUrl}/auth/callback#code=${encodeURIComponent(code)}`,
      );
    } catch (err) {
      if (err instanceof SsoLoginRejectedError) return this.toLogin(res, err.reason);
      this.logger.error(`SSO callback failed: ${describe(err)}`);
      this.toLogin(res, "login_failed");
    }
  }

  @ApiOperation({ summary: "Trade the callback's single-use code for an OpsDesk access token" })
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post("exchange")
  async exchange(@Body() dto: SsoExchangeDto) {
    const user = await this.sso.redeemLoginCode(dto.code);
    return this.authService.issueToken(user);
  }

  @ApiOperation({ summary: "End the IdP session (browser redirect)" })
  @Get("logout")
  async logout(@Res() res: Response): Promise<void> {
    const loginPage = `${this.oidc.config.webAppUrl}/login`;
    if (!this.oidc.enabled) return res.redirect(302, loginPage);
    try {
      res.redirect(302, (await this.oidc.logoutUrl(loginPage)) ?? loginPage);
    } catch (err) {
      this.logger.warn(`SSO logout redirect unavailable: ${describe(err)}`);
      res.redirect(302, loginPage);
    }
  }

  private readTransaction(req: Request): OidcTransaction | null {
    const raw = readCookie(req.headers.cookie, OIDC_TX_COOKIE);
    if (!raw) return null;
    try {
      const { state, nonce, codeVerifier } = this.jwt.verify<OidcTransaction>(raw, {
        audience: OIDC_TX_AUDIENCE,
      });
      return state && nonce && codeVerifier ? { state, nonce, codeVerifier } : null;
    } catch {
      return null;
    }
  }

  private cookieOptions(maxAge?: number) {
    return {
      httpOnly: true,
      // Lax, not Strict: the callback is a top-level cross-site navigation from the IdP.
      sameSite: "lax" as const,
      secure: this.oidc.config.redirectUri.startsWith("https://"),
      path: "/api/v1/auth/oidc",
      ...(maxAge ? { maxAge } : {}),
    };
  }

  private toLogin(res: Response, reason: string): void {
    res.redirect(
      302,
      `${this.oidc.config.webAppUrl}/login?sso_error=${encodeURIComponent(reason)}`,
    );
  }
}

function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx > 0 && part.slice(0, idx).trim() === name) {
      return decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return null;
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
