import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { ApiTokensService } from "./api-tokens.service";
import { AuthService } from "./auth.service";
import { AuthzService } from "./authz.service";
import { JwtAuthGuard } from "./guards/jwt-auth.guard";
import { RolesGuard } from "./guards/roles.guard";
import { SiteScopeGuard } from "./guards/site-scope.guard";
import { PasswordAuthController } from "./password-auth.controller";
import { PasswordAuthService } from "./password-auth.service";
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
 * People sign in with email + password only (PasswordAuthService: scrypt,
 * lockout). A Super Admin adds a user either with a starting password (the
 * user must change it at first sign-in) or with an emailed invite link.
 * Machines use admin-issued API tokens (ApiTokensService). JwtAuthGuard
 * accepts either.
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
  controllers: [PasswordAuthController, UsersController, UserAdminController],
  providers: [
    AuthService,
    AuthzService,
    PasswordAuthService,
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
