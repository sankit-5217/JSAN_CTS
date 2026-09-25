import { Body, Controller, ForbiddenException, Get, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { AuthService } from "./auth.service";
import { DevLoginDto } from "./dto/dev-login.dto";
import { OidcClientService } from "./oidc/oidc-client.service";

@ApiTags("auth")
@Controller("auth")
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly oidc: OidcClientService,
  ) {}

  /** Which sign-in options the login page should offer (public, no secrets). */
  @Get("providers")
  providers() {
    return {
      sso: { enabled: this.oidc.enabled, label: this.oidc.config.providerLabel },
      devLogin: process.env.NODE_ENV !== "production",
    };
  }

  /**
   * Dev-only bootstrap login — no password, just looks up a seeded active
   * user by email and issues a JWT. Real login is SSO (OidcController);
   * this stays for local/dev and tests only, disabled in production so it
   * can never become the production auth path by accident.
   */
  // Tighter than the app-wide default (spec §18 — login endpoints need
  // stronger brute-force protection than a generic list/detail route).
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post("dev-login")
  async devLogin(@Body() dto: DevLoginDto) {
    if (process.env.NODE_ENV === "production") {
      throw new ForbiddenException("dev-login is disabled in production");
    }
    const user = await this.authService.validateUserByEmail(dto.email);
    return this.authService.issueToken(user);
  }
}
