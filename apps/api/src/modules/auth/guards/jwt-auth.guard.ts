import { ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AuthGuard } from "@nestjs/passport";
import { ALLOW_WHILE_PASSWORD_CHANGE_REQUIRED } from "../decorators/allow-while-password-change-required.decorator";
import { AuthenticatedUser } from "../types/jwt-payload.type";

export const PASSWORD_CHANGE_REQUIRED = "PASSWORD_CHANGE_REQUIRED";

/**
 * Authenticates the Bearer credential and attaches the resolved user to
 * `req.user`: a machine API token (`odk_...`, ApiTokenStrategy) or a signed-in
 * person's JWT (JwtStrategy). Apply this before RolesGuard/SiteScopeGuard on
 * every protected route — those guards assume `req.user` is populated.
 *
 * A person whose password was set by an admin must choose their own before
 * anything else: until then only routes marked
 * @AllowWhilePasswordChangeRequired() are open to them (enforced here, not
 * by the web app). The guard stays dependency-free (its own Reflector), so
 * any module can use it without importing AuthModule's providers.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard(["api-token", "jwt"]) {
  private readonly reflector = new Reflector();

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!((await super.canActivate(context)) as boolean)) return false;
    const user = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>().user;
    if (user?.mustChangePassword) {
      const allowed = this.reflector.getAllAndOverride<boolean>(
        ALLOW_WHILE_PASSWORD_CHANGE_REQUIRED,
        [context.getHandler(), context.getClass()],
      );
      if (!allowed) {
        throw new ForbiddenException({
          statusCode: 403,
          code: PASSWORD_CHANGE_REQUIRED,
          message: "Choose a new password before continuing.",
        });
      }
    }
    return true;
  }
}
