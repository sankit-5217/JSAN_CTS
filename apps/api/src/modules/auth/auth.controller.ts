import { Controller, Get } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { SocialProvidersService } from "./social/social-providers.service";

@ApiTags("auth")
@Controller("auth")
export class AuthController {
  constructor(private readonly social: SocialProvidersService) {}

  /** Which sign-in options the login page should offer (public, no secrets). */
  @Get("providers")
  @ApiOperation({
    summary: "Sign-in options: password is always on; social providers when configured",
  })
  providers() {
    return { password: true, social: this.social.list() };
  }
}
