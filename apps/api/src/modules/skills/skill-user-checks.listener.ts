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
 * Answers the auth module's role-change check: only engineers hold skills,
 * so an engineer can't move to a non-engineer role while they still have
 * any. Remove them on Team & Shifts first.
 */
@Injectable()
export class SkillUserChecksListener {
  constructor(private readonly prisma: PrismaService) {}

  @OnEvent(USER_ROLE_CHANGE_CHECK_EVENT, { suppressErrors: false })
  async onRoleChangeCheck(check: UserRoleChangeCheck): Promise<UserChangeBlocker | null> {
    if (isEngineerRole(check.toRole)) return null;
    const skills = await this.prisma.userSkill.findMany({
      where: { userId: check.userId },
      select: { skill: { select: { name: true } } },
      orderBy: { skill: { name: "asc" } },
    });
    if (skills.length === 0) return null;
    return {
      source: "skills",
      message: `holds ${skills.length} skill${skills.length === 1 ? "" : "s"}, which only engineers can have — remove them on Team & Shifts first`,
      examples: skills.slice(0, 5).map((s) => s.skill.name),
    };
  }
}
