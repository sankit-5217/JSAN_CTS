import { Injectable } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import { PrismaService } from "../../common/prisma/prisma.service";
import { isEngineerRole } from "../auth/engineer-roles";
import {
  USER_ROLE_CHANGE_CHECK_EVENT,
  UserChangeBlocker,
  UserRoleChangeCheck,
} from "../auth/user-change-checks";

/**
 * Answers the auth module's role-change check: only engineers work shifts,
 * so an engineer can't move to a non-engineer role while any of their
 * shifts is still active. Disable them on Team & Shifts first (shifts are
 * disabled, not deleted, and can't be re-enabled for a non-engineer).
 */
@Injectable()
export class ShiftUserChecksListener {
  constructor(private readonly prisma: PrismaService) {}

  @OnEvent(USER_ROLE_CHANGE_CHECK_EVENT, { suppressErrors: false })
  async onRoleChangeCheck(check: UserRoleChangeCheck): Promise<UserChangeBlocker | null> {
    if (isEngineerRole(check.toRole)) return null;
    const shifts = await this.prisma.engineerShift.findMany({
      where: { userId: check.userId, isActive: true },
      select: { label: true },
      orderBy: { label: "asc" },
    });
    if (shifts.length === 0) return null;
    return {
      source: "shifts",
      message: `has ${shifts.length} active shift${shifts.length === 1 ? "" : "s"} — disable ${shifts.length === 1 ? "it" : "them"} on Team & Shifts first`,
      examples: shifts.slice(0, 5).map((s) => s.label),
    };
  }
}
