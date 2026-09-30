import { Body, Controller, Get, Logger, Param, Post, Query, Req, Res } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { Request, Response } from "express";
import { CorrelationId } from "../../../common/decorators/correlation-id.decorator";
import { AuthService } from "../auth.service";
import { SocialExchangeDto } from "../dto/social-exchange.dto";
import { SocialTransaction } from "./social-provider";
import { SocialIdentityService, SocialLoginRejectedError } from "./social-identity.service";
import { SocialProvidersService } from "./social-providers.service";

/** httpOnly cookie carrying state/nonce/PKCE verifier from /login to /callback. */
export const SOCIAL_TX_COOKIE = "opsdesk_social_tx";
const SOCIAL_TX_AUDIENCE = "opsdesk-social-tx";
const SOCIAL_TX_TTL_SECONDS = 600;

/**
 * Google / Microsoft / GitHub sign-in (backend authorization-code flow):
 *
 *   GET  /auth/social/:provider/login     -> 302 to the provider (secrets in a signed cookie)
 *   GET  /auth/social/:provider/callback  -> verifies the provider's answer, maps it to an
 *                                            existing user, 302 to the web app with a 60s
 *                                            single-use code in the URL fragment
 *   POST /auth/social/exchange            -> code -> the app JWT (same as password login)
 *
 * The provider's tokens never reach the browser; client secrets stay here.
 */
@ApiTags("auth")
@Controller("auth/social")
export class SocialAuthController {
  private readonly logger = new Logger(SocialAuthController.name);

  constructor(
    private readonly providers: SocialProvidersService,
    private readonly identities: SocialIdentityService,
    private readonly authService: AuthService,
    private readonly jwt: JwtService,
  ) {}

  @ApiOperation({ summary: "Trade the callback's single-use code for an OpsDesk access token" })
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post("exchange")
  async exchange(@Body() dto: SocialExchangeDto) {
    const user = await this.identities.redeemHandoffCode(dto.code);
    return this.authService.issueToken(user);
  }

  @ApiOperation({ summary: "Start social sign-in (browser redirect to the provider)" })
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Get(":provider/login")
  async login(@Param("provider") providerId: string, @Res() res: Response): Promise<void> {
    const provider = this.providers.get(providerId);
    if (!provider) return this.toLogin(res, "provider_disabled");
    try {
      const { url, tx } = await provider.startLogin();
      res.cookie(
        SOCIAL_TX_COOKIE,
        this.jwt.sign(
          { ...tx },
          { audience: SOCIAL_TX_AUDIENCE, expiresIn: SOCIAL_TX_TTL_SECONDS },
        ),
        this.cookieOptions(SOCIAL_TX_TTL_SECONDS * 1000),
      );
      res.redirect(302, url);
    } catch (err) {
      this.logger.error(`${providerId} sign-in start failed: ${describe(err)}`);
      this.toLogin(res, "provider_unavailable");
    }
  }

  @ApiOperation({ summary: "Provider redirect target — not called directly" })
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Get(":provider/callback")
  async callback(
    @Param("provider") providerId: string,
    @Query() query: Record<string, string>,
    @Req() req: Request,
    @Res() res: Response,
    @CorrelationId() correlationId?: string,
  ): Promise<void> {
    const tx = this.readTransaction(req);
    res.clearCookie(SOCIAL_TX_COOKIE, this.cookieOptions());
    const provider = this.providers.get(providerId);

    if (!provider) return this.toLogin(res, "provider_disabled");
    if (query.error) {
      this.logger.warn(`${providerId} returned error on callback: ${query.error}`);
      return this.toLogin(res, "provider_error");
    }
    if (!tx || tx.provider !== provider.id || !query.state || query.state !== tx.state) {
      this.logger.warn(`${providerId} callback with missing/expired transaction or state mismatch`);
      return this.toLogin(res, "invalid_state");
    }

    try {
      const identity = await provider.completeLogin(query, tx);
      const user = await this.identities.resolveUser(identity, correlationId);
      const code = await this.identities.createHandoffCode(user.id);
      res.redirect(
        302,
        `${this.providers.config.webAppUrl}/auth/callback#code=${encodeURIComponent(code)}`,
      );
    } catch (err) {
      if (err instanceof SocialLoginRejectedError) return this.toLogin(res, err.reason);
      this.logger.error(`${providerId} callback failed: ${describe(err)}`);
      this.toLogin(res, "login_failed");
    }
  }

  private readTransaction(req: Request): SocialTransaction | null {
    const raw = readCookie(req.headers.cookie, SOCIAL_TX_COOKIE);
    if (!raw) return null;
    try {
      const { provider, state, nonce, codeVerifier } = this.jwt.verify<SocialTransaction>(raw, {
        audience: SOCIAL_TX_AUDIENCE,
      });
      return provider && state ? { provider, state, nonce, codeVerifier } : null;
    } catch {
      return null;
    }
  }

  private cookieOptions(maxAge?: number) {
    return {
      httpOnly: true,
      // Lax, not Strict: the callback is a top-level cross-site navigation from the provider.
      sameSite: "lax" as const,
      secure: this.providers.config.apiPublicUrl.startsWith("https://"),
      path: "/api/v1/auth/social",
      ...(maxAge ? { maxAge } : {}),
    };
  }

  private toLogin(res: Response, reason: string): void {
    res.redirect(
      302,
      `${this.providers.config.webAppUrl}/login?social_error=${encodeURIComponent(reason)}`,
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
