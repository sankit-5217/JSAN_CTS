import "reflect-metadata";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import { UserRole } from "@prisma/client";
import { ROLES_KEY } from "../auth/decorators/roles.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { NotificationSoundRulesController } from "./notification-sound-rules.controller";

describe("NotificationSoundRulesController authorization wiring", () => {
  const proto = NotificationSoundRulesController.prototype;

  it("is guarded by JwtAuthGuard then RolesGuard", () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, NotificationSoundRulesController);
    expect(guards).toEqual([JwtAuthGuard, RolesGuard]);
  });

  it("leaves the list open to any signed-in user", () => {
    expect(Reflect.getMetadata(ROLES_KEY, proto.list)).toBeUndefined();
  });

  it("limits writes to the SLA policy owners", () => {
    expect(Reflect.getMetadata(ROLES_KEY, proto.set)).toEqual([
      UserRole.SUPER_ADMIN,
      UserRole.DELIVERY_OPS_MANAGER,
    ]);
  });
});
