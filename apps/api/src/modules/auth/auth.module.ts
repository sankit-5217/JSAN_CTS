import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { AuthzService } from "./authz.service";
import { OidcController } from "./oidc.controller";
import { OidcClientService } from "./oidc/oidc-client.service";
import { SsoService } from "./sso.service";
import { JwtAuthGuard } from "./guards/jwt-auth.guard";
import { RolesGuard } from "./guards/roles.guard";
import { SiteScopeGuard } from "./guards/site-scope.guard";
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
 * Login is SSO via any OIDC IdP (OidcController + SsoService, backend
 * authorization-code + PKCE flow; users must be pre-provisioned). Both SSO
 * and the dev-only AuthController.devLogin end in the same app JWT, so the
 * guards/strategy below don't care which path a user signed in through.
 * No password store, by design (spec §17).
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
  controllers: [AuthController, OidcController, UsersController, UserAdminController],
  providers: [
    AuthService,
    AuthzService,
    OidcClientService,
    SsoService,
    UsersService,
    UserAdminService,
    JwtStrategy,
    JwtAuthGuard,
    RolesGuard,
    SiteScopeGuard,
  ],
  exports: [AuthService, AuthzService, JwtAuthGuard, RolesGuard, SiteScopeGuard],
})
export class AuthModule {}
