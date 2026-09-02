import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { AuthzService } from "./authz.service";
import { JwtAuthGuard } from "./guards/jwt-auth.guard";
import { RolesGuard } from "./guards/roles.guard";
import { SiteScopeGuard } from "./guards/site-scope.guard";
import { JwtStrategy } from "./strategies/jwt.strategy";

/**
 * Owner: Dev A (Platform & Ticketing Core).
 * Owns: identity mapping, sessions/tokens, roles (spec §12).
 * Must not own: incident business rules.
 *
 * Auth is JWT-based for now (dev-login bootstrap, no password store) —
 * see docs/PROJECT_OVERVIEW.md Sprint 2 notes. The guards/strategy here
 * are the long-lived piece; only AuthController.devLogin gets replaced
 * when real OIDC/IdP integration lands.
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
  controllers: [AuthController],
  providers: [AuthService, AuthzService, JwtStrategy, JwtAuthGuard, RolesGuard, SiteScopeGuard],
  exports: [AuthService, AuthzService, JwtAuthGuard, RolesGuard, SiteScopeGuard],
})
export class AuthModule {}
