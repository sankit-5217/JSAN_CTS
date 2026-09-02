import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { AuthzService } from "../authz.service";
import { AuthenticatedUser } from "../types/jwt-payload.type";

/**
 * Enforces site scope on routes that identify a single site, directly
 * (`:id` on the sites controller) or via a nested resource (`:siteId` on
 * contacts/calendars). Routes with neither param (e.g. `GET /sites`) are
 * left alone here — list endpoints filter via
 * `AuthzService.getAccessibleSiteIds` in the service layer instead of
 * being blocked outright. Must run after JwtAuthGuard.
 */
@Injectable()
export class SiteScopeGuard implements CanActivate {
  constructor(private readonly authzService: AuthzService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<{ user?: AuthenticatedUser; params: Record<string, string> }>();

    const siteId = request.params.siteId ?? request.params.id;
    if (!siteId || !request.user) {
      return true;
    }

    const allowed = await this.authzService.canAccessSite(request.user, siteId);
    if (!allowed) {
      throw new ForbiddenException("You do not have access to this site");
    }
    return true;
  }
}
