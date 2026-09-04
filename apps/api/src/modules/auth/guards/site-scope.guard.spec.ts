import { ExecutionContext, ForbiddenException } from "@nestjs/common";
import { AuthzService } from "../authz.service";
import { SiteScopeGuard } from "./site-scope.guard";

function makeContext(user: unknown, params: Record<string, string>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user, params }) }),
  } as unknown as ExecutionContext;
}

describe("SiteScopeGuard", () => {
  it("allows the request when the route has no siteId/id param (list endpoints filter in the service layer instead)", async () => {
    const authzService = { canAccessSite: jest.fn() } as unknown as AuthzService;
    const guard = new SiteScopeGuard(authzService);
    await expect(
      guard.canActivate(makeContext({ id: "user-1" }, {})),
    ).resolves.toBe(true);
    expect(authzService.canAccessSite).not.toHaveBeenCalled();
  });

  it("allows the request when there's no authenticated user (JwtAuthGuard runs first and already rejected it)", async () => {
    const authzService = { canAccessSite: jest.fn() } as unknown as AuthzService;
    const guard = new SiteScopeGuard(authzService);
    await expect(
      guard.canActivate(makeContext(undefined, { id: "site-1" })),
    ).resolves.toBe(true);
    expect(authzService.canAccessSite).not.toHaveBeenCalled();
  });

  it("allows access via the :id param when canAccessSite resolves true (GET /sites/:id shape)", async () => {
    const authzService = {
      canAccessSite: jest.fn().mockResolvedValue(true),
    } as unknown as AuthzService;
    const guard = new SiteScopeGuard(authzService);
    const user = { id: "user-1", role: "SITE_ENGINEER" };
    await expect(
      guard.canActivate(makeContext(user, { id: "site-1" })),
    ).resolves.toBe(true);
    expect(authzService.canAccessSite).toHaveBeenCalledWith(user, "site-1");
  });

  it("rejects via the :id param when canAccessSite resolves false", async () => {
    const authzService = {
      canAccessSite: jest.fn().mockResolvedValue(false),
    } as unknown as AuthzService;
    const guard = new SiteScopeGuard(authzService);
    const user = { id: "user-1", role: "SITE_ENGINEER" };
    await expect(guard.canActivate(makeContext(user, { id: "site-2" }))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it("allows access via the :siteId param when canAccessSite resolves true (nested contacts/calendars shape)", async () => {
    const authzService = {
      canAccessSite: jest.fn().mockResolvedValue(true),
    } as unknown as AuthzService;
    const guard = new SiteScopeGuard(authzService);
    const user = { id: "user-1", role: "SITE_ENGINEER" };
    await expect(
      guard.canActivate(makeContext(user, { siteId: "site-1" })),
    ).resolves.toBe(true);
    expect(authzService.canAccessSite).toHaveBeenCalledWith(user, "site-1");
  });

  it("rejects via the :siteId param when canAccessSite resolves false (a CTS viewer can't see another restricted site)", async () => {
    const authzService = {
      canAccessSite: jest.fn().mockResolvedValue(false),
    } as unknown as AuthzService;
    const guard = new SiteScopeGuard(authzService);
    const user = { id: "user-1", role: "CTS_MANAGER_VIEWER" };
    await expect(
      guard.canActivate(makeContext(user, { siteId: "site-2" })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
