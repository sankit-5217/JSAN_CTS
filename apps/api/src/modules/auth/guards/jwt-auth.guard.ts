import { Injectable } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";

/**
 * Validates the Bearer JWT (via JwtStrategy) and attaches the resolved
 * user to `req.user`. Apply this before RolesGuard/SiteScopeGuard on every
 * protected route — those guards assume `req.user` is already populated.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard("jwt") {}
