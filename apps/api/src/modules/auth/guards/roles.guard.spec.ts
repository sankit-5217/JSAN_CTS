import { ExecutionContext, ForbiddenException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { UserRole } from "@prisma/client";
import { RolesGuard } from "./roles.guard";

function makeContext(user: unknown): ExecutionContext {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

describe("RolesGuard", () => {
  it("allows the request when the route has no @Roles() metadata", () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(undefined),
    } as unknown as Reflector;
    const guard = new RolesGuard(reflector);
    expect(guard.canActivate(makeContext({ role: UserRole.SITE_ENGINEER }))).toBe(true);
  });

  it("allows the request when the user's role is in the required list", () => {
    const reflector = {
      getAllAndOverride: jest
        .fn()
        .mockReturnValue([UserRole.SUPER_ADMIN, UserRole.DELIVERY_OPS_MANAGER]),
    } as unknown as Reflector;
    const guard = new RolesGuard(reflector);
    expect(guard.canActivate(makeContext({ role: UserRole.SUPER_ADMIN }))).toBe(true);
  });

  it("rejects when the user's role is not in the required list", () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue([UserRole.SUPER_ADMIN]),
    } as unknown as Reflector;
    const guard = new RolesGuard(reflector);
    expect(() => guard.canActivate(makeContext({ role: UserRole.SITE_ENGINEER }))).toThrow(
      ForbiddenException,
    );
  });

  it("rejects when there's no authenticated user at all", () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue([UserRole.SUPER_ADMIN]),
    } as unknown as Reflector;
    const guard = new RolesGuard(reflector);
    expect(() => guard.canActivate(makeContext(undefined))).toThrow(ForbiddenException);
  });
});
