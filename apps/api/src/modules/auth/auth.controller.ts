import { Body, Controller, ForbiddenException, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { AuthService } from "./auth.service";
import { DevLoginDto } from "./dto/dev-login.dto";

@ApiTags("auth")
@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * Dev-only bootstrap login — no password, just looks up a seeded active
   * user by email and issues a JWT. Replaced by real OIDC/IdP login in a
   * later sprint; disabled outside local/dev so it can never become the
   * production auth path by accident.
   */
  @Post("dev-login")
  async devLogin(@Body() dto: DevLoginDto) {
    if (process.env.NODE_ENV === "production") {
      throw new ForbiddenException("dev-login is disabled in production");
    }
    const user = await this.authService.validateUserByEmail(dto.email);
    return this.authService.issueToken(user);
  }
}
