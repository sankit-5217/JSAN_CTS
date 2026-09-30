import { Body, Controller, HttpCode, Post } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { CorrelationId } from "../../common/decorators/correlation-id.decorator";
import { AuthService } from "./auth.service";
import {
  ForgotPasswordDto,
  PasswordLoginDto,
  PasswordTokenDto,
  SetPasswordDto,
} from "./dto/password.dto";
import { PasswordAuthService } from "./password-auth.service";

/**
 * Email + password sign-in. Tokens travel in request bodies (never URLs),
 * and every route here is rate-limited per IP on top of the per-account
 * lockout (spec §18: stronger brute-force protection on login).
 */
@ApiTags("auth")
@Controller("auth")
export class PasswordAuthController {
  constructor(
    private readonly passwords: PasswordAuthService,
    private readonly authService: AuthService,
  ) {}

  @Post("login")
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: "Sign in with email and password" })
  async login(@Body() dto: PasswordLoginDto, @CorrelationId() correlationId?: string) {
    const user = await this.passwords.login(dto.email, dto.password, correlationId);
    return this.authService.issueToken(user);
  }

  @Post("password/forgot")
  @HttpCode(202)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary: "Email a password reset link (same answer whether or not the account exists)",
  })
  async forgot(@Body() dto: ForgotPasswordDto, @CorrelationId() correlationId?: string) {
    await this.passwords.requestReset(dto.email, correlationId);
    return { message: "If that email has an OpsDesk account, a reset link is on its way." };
  }

  @Post("password/inspect")
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: "Check an invite/reset link and see who it's for" })
  inspect(@Body() dto: PasswordTokenDto) {
    return this.passwords.inspectToken(dto.token);
  }

  @Post("password/set")
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: "Choose a password from an invite/reset link; signs you in" })
  async set(@Body() dto: SetPasswordDto, @CorrelationId() correlationId?: string) {
    const user = await this.passwords.setPassword(dto.token, dto.password, correlationId);
    return this.authService.issueToken(user);
  }
}
