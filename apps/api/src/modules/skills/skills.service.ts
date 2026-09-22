import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Skill, UserSkill } from "@prisma/client";
import { PrismaService } from "../../common/prisma/prisma.service";
import { ActorContext } from "../../common/types/actor-context.type";
import { AuditService } from "../audit/audit.service";
import { AssignSkillDto } from "./dto/assign-skill.dto";
import { CreateSkillDto } from "./dto/create-skill.dto";
import { UpdateSkillDto } from "./dto/update-skill.dto";

export interface AssignmentWithSkill extends UserSkill {
  skill: Skill;
}

/**
 * Owns: the skill taxonomy and which engineers have which skills (Phase 1
 * of skill-based routing — see docs/monitoring-alert-pipeline.pdf's sibling
 * routing design, not yet built). Must not own: incident assignment itself
 * (incidents module's job) or which skill an alert/category requires (a
 * later routing-engine phase) — this module only tracks the raw taxonomy
 * and membership.
 */
@Injectable()
export class SkillsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async findAllSkills(activeOnly?: boolean): Promise<Skill[]> {
    return this.prisma.skill.findMany({
      where: activeOnly ? { isActive: true } : undefined,
      orderBy: { name: "asc" },
    });
  }

  private async findSkillOrThrow(id: string): Promise<Skill> {
    const skill = await this.prisma.skill.findUnique({ where: { id } });
    if (!skill) {
      throw new NotFoundException(`Skill ${id} not found`);
    }
    return skill;
  }

  async createSkill(dto: CreateSkillDto, actor: ActorContext): Promise<Skill> {
    const name = dto.name.trim();
    const existing = await this.prisma.skill.findFirst({
      where: { name: { equals: name, mode: "insensitive" } },
    });
    if (existing) {
      throw new ConflictException(`A skill named "${name}" already exists`);
    }

    return this.prisma.$transaction(async (tx) => {
      const skill = await tx.skill.create({ data: { name } });
      await this.auditService.record(
        {
          actorId: actor.actorId,
          entityType: "Skill",
          entityId: skill.id,
          action: "CREATE",
          after: skill,
          correlationId: actor.correlationId,
        },
        tx,
      );
      return skill;
    });
  }

  async updateSkill(id: string, dto: UpdateSkillDto, actor: ActorContext): Promise<Skill> {
    const before = await this.findSkillOrThrow(id);

    if (dto.name && dto.name.trim().toLowerCase() !== before.name.toLowerCase()) {
      const clash = await this.prisma.skill.findFirst({
        where: { name: { equals: dto.name.trim(), mode: "insensitive" }, id: { not: id } },
      });
      if (clash) {
        throw new ConflictException(`A skill named "${dto.name.trim()}" already exists`);
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const after = await tx.skill.update({
        where: { id },
        data: { name: dto.name?.trim(), isActive: dto.isActive },
      });
      await this.auditService.record(
        {
          actorId: actor.actorId,
          entityType: "Skill",
          entityId: id,
          action: "UPDATE",
          before,
          after,
          correlationId: actor.correlationId,
        },
        tx,
      );
      return after;
    });
  }

  /** Every engineer-skill assignment across the org — the frontend groups
   * this by userId itself rather than issuing one request per engineer. */
  async findAllAssignments(): Promise<AssignmentWithSkill[]> {
    return this.prisma.userSkill.findMany({
      include: { skill: true },
      orderBy: { createdAt: "asc" },
    });
  }

  async assignSkill(
    skillId: string,
    dto: AssignSkillDto,
    actor: ActorContext,
  ): Promise<UserSkill> {
    const [skill, user] = await Promise.all([
      this.findSkillOrThrow(skillId),
      this.prisma.user.findUnique({ where: { id: dto.userId } }),
    ]);
    if (!user) {
      throw new BadRequestException(`User ${dto.userId} not found`);
    }
    if (!skill.isActive) {
      throw new BadRequestException(`Skill "${skill.name}" is retired and can't be assigned`);
    }

    const existing = await this.prisma.userSkill.findUnique({
      where: { userId_skillId: { userId: dto.userId, skillId } },
    });
    if (existing) {
      throw new ConflictException(`${user.displayName} already has the "${skill.name}" skill`);
    }

    return this.prisma.$transaction(async (tx) => {
      const assignment = await tx.userSkill.create({
        data: { userId: dto.userId, skillId },
      });
      await this.auditService.record(
        {
          actorId: actor.actorId,
          entityType: "UserSkill",
          entityId: assignment.id,
          action: "CREATE",
          after: { userId: dto.userId, skillId, skillName: skill.name },
          correlationId: actor.correlationId,
        },
        tx,
      );
      return assignment;
    });
  }

  async unassignSkill(skillId: string, userId: string, actor: ActorContext): Promise<void> {
    const existing = await this.prisma.userSkill.findUnique({
      where: { userId_skillId: { userId, skillId } },
    });
    if (!existing) {
      throw new NotFoundException("That engineer does not have this skill assigned");
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.userSkill.delete({ where: { id: existing.id } });
      await this.auditService.record(
        {
          actorId: actor.actorId,
          entityType: "UserSkill",
          entityId: existing.id,
          action: "DELETE",
          before: existing,
          correlationId: actor.correlationId,
        },
        tx,
      );
    });
  }
}
