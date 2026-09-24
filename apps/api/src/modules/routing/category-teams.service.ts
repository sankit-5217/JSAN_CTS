import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { CategoryTeam } from "@prisma/client";
import { PrismaService } from "../../common/prisma/prisma.service";
import { ActorContext } from "../../common/types/actor-context.type";
import { AuditService } from "../audit/audit.service";
import { SitesService } from "../sites/sites.service";
import { CreateCategoryTeamDto } from "./dto/create-category-team.dto";

export interface CategoryTeamView {
  id: string;
  category: string;
  groupId: string;
  groupName: string;
  createdAt: Date;
}

export interface TeamRoster {
  id: string;
  name: string;
  memberIds: string[];
}

/**
 * Category -> owning team (support group). Routing prefers that team's
 * members for a category's incidents, and an accepted offer records the team
 * on the incident. One team per category, matched case-insensitively like
 * the category -> skill requirements. Group membership itself belongs to the
 * sites module and is read through SitesService.
 */
@Injectable()
export class CategoryTeamsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly sitesService: SitesService,
  ) {}

  async list(): Promise<CategoryTeamView[]> {
    const rows = await this.prisma.categoryTeam.findMany({
      include: { group: { select: { name: true } } },
      orderBy: { category: "asc" },
    });
    return rows.map((r) => this.toView(r, r.group.name));
  }

  async create(dto: CreateCategoryTeamDto, actor: ActorContext): Promise<CategoryTeamView> {
    const category = dto.category.trim();
    if (!category) {
      throw new BadRequestException("Category is required");
    }
    const roster = await this.sitesService.findGroupRoster(dto.groupId);
    if (!roster) {
      throw new NotFoundException(`Support group ${dto.groupId} not found`);
    }
    const existing = await this.findForCategory(category);
    if (existing) {
      throw new ConflictException(
        `"${existing.category}" is already owned by another team; remove that mapping first`,
      );
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.categoryTeam.create({ data: { category, groupId: dto.groupId } });
      await this.auditService.record(
        {
          actorId: actor.actorId,
          entityType: "CategoryTeam",
          entityId: row.id,
          action: "CREATE",
          after: { category, groupId: dto.groupId, groupName: roster.name },
          correlationId: actor.correlationId,
        },
        tx,
      );
      return row;
    });
    return this.toView(created, roster.name);
  }

  async remove(id: string, actor: ActorContext): Promise<void> {
    const existing = await this.prisma.categoryTeam.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`Category team mapping ${id} not found`);
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.categoryTeam.delete({ where: { id } });
      await this.auditService.record(
        {
          actorId: actor.actorId,
          entityType: "CategoryTeam",
          entityId: id,
          action: "DELETE",
          before: existing,
          correlationId: actor.correlationId,
        },
        tx,
      );
    });
  }

  /** The team that owns a category, with its active members; null when the
   *  category has no mapping. */
  async teamForCategory(category: string): Promise<TeamRoster | null> {
    const mapping = await this.findForCategory(category);
    return mapping ? this.sitesService.findGroupRoster(mapping.groupId) : null;
  }

  /** A specific team's roster (e.g. the group already on an incident). */
  rosterFor(groupId: string): Promise<TeamRoster | null> {
    return this.sitesService.findGroupRoster(groupId);
  }

  private findForCategory(category: string): Promise<CategoryTeam | null> {
    return this.prisma.categoryTeam.findFirst({
      where: { category: { equals: category.trim(), mode: "insensitive" } },
    });
  }

  private toView(row: CategoryTeam, groupName: string): CategoryTeamView {
    return {
      id: row.id,
      category: row.category,
      groupId: row.groupId,
      groupName,
      createdAt: row.createdAt,
    };
  }
}
