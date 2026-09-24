import "reflect-metadata";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import { UserRole } from "@prisma/client";
import { ROLES_KEY } from "../auth/decorators/roles.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { InboxController } from "./inbox.controller";

// Same contract as authz-contract.spec.ts for Dev B's controllers: guarded at
// the class level, writes declare @Roles, reads don't. Every role gets a bell,
// so the write routes list all of them.
describe("InboxController authorization wiring", () => {
  const proto = InboxController.prototype;

  it("is guarded by JwtAuthGuard then RolesGuard", () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, InboxController) as unknown[];
    expect(guards).toEqual([JwtAuthGuard, RolesGuard]);
  });

  it("leaves the list route open to any signed-in user", () => {
    expect(Reflect.getMetadata(ROLES_KEY, proto.list)).toBeUndefined();
  });

  it.each(["markRead", "markAllRead"] as const)("%s allows every role", (name) => {
    expect(Reflect.getMetadata(ROLES_KEY, proto[name])).toEqual(Object.values(UserRole));
  });
});
