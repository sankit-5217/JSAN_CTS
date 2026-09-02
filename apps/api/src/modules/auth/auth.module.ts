import { Module } from "@nestjs/common";

/**
 * Owner: Dev A (Platform & Ticketing Core).
 * Owns: identity mapping, sessions/tokens, roles (spec §12).
 * Must not own: incident business rules.
 *
 * TODO (Sprint 2): OIDC/OAuth2 integration (Keycloak in dev), RBAC guard
 * (role + site/customer scope, spec §4 and §17), JWT strategy.
 */
@Module({})
export class AuthModule {}
