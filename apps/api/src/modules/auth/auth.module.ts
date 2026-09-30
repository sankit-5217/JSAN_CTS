import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { ApiTokensService } from "./api-tokens.service";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { AuthzService } from "./authz.service";
import { JwtAuthGuard } from "./guards/jwt-auth.guard";
import { RolesGuard } from "./guards/roles.guard";
import { SiteScopeGuard } from "./guards/site-scope.guard";
import { PasswordAuthController } from "./password-auth.controller";
import { PasswordAuthService } from "./password-auth.service";
import { SocialAuthController } from "./social/social-auth.controller";
import { SocialIdentityService } from "./social/social-identity.service";
import { SocialProvidersService } from "./social/social-providers.service";
import { ApiTokenStrategy } from "./strategies/api-token.strategy";
import { JwtStrategy } from "./strategies/jwt.strategy";
import { UserAdminController } from "./user-admin.controller";
import { UserAdminService } from "./user-admin.service";
import { UsersController } from "./users.controller";
import { UsersService } from "./users.service";

/**
 * Owner: Dev A (Platform & Ticketing Core).
 * Owns: identity mapping, sessions/tokens, roles (spec §12).
 * Must not own: incident business rules.
 *
 * People sign in with email + password (PasswordAuthService: scrypt,
 * lockout, emailed invite/reset links) or Google / Microsoft / GitHub
 * (SocialAuthController; existing users only, matched by verified email and
 * then by linked identity). Both end in the same app JWT. Machines use
 * admin-issued API tokens (ApiTokensService). JwtAuthGuard accepts either.
 *
 * Site-scope authorization: AuthzService resolves which sites a user can
 * see (spec §4's per-role "Typical Access" column); SiteScopeGuard
 * enforces it on single-site routes, service-layer filtering handles list
 * routes.
 */
@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>("JWT_SECRET", "change-me-dev-only"),
      }),
    }),
  ],
  controllers: [
    AuthController,
    PasswordAuthController,
    SocialAuthController,
    UsersController,
    UserAdminController,
  ],
  providers: [
    AuthService,
    AuthzService,
    PasswordAuthService,
    SocialProvidersService,
    SocialIdentityService,
    ApiTokensService,
    UsersService,
    UserAdminService,
    JwtStrategy,
    ApiTokenStrategy,
    JwtAuthGuard,
    RolesGuard,
    SiteScopeGuard,
  ],
  exports: [AuthService, AuthzService, JwtAuthGuard, RolesGuard, SiteScopeGuard],
})
export class AuthModule {}
