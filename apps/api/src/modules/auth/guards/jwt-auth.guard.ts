import { Injectable } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";

/**
 * Authenticates the Bearer credential and attaches the resolved user to
 * `req.user`: a machine API token (`odk_...`, ApiTokenStrategy) or a signed-in
 * person's JWT (JwtStrategy). Apply this before RolesGuard/SiteScopeGuard on
 * every protected route — those guards assume `req.user` is populated.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard(["api-token", "jwt"]) {}
