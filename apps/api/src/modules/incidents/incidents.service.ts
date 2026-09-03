import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Incident, Prisma } from "@prisma/client";
import { ActorContext } from "../../common/types/actor-context.type";
import { PrismaService } from "../../common/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { AuthzService } from "../auth/authz.service";
import { AuthenticatedUser } from "../auth/types/jwt-payload.type";
import { CreateIncidentDto } from "./dto/create-incident.dto";
import { ListIncidentsQueryDto } from "./dto/list-incidents-query.dto";
import { TransitionIncidentDto } from "./dto/transition-incident.dto";
import { UpdateIncidentDto } from "./dto/update-incident.dto";
import { findTransitionRule, isOwnerOrElevated } from "./incident-transitions";

export interface Paginated<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * Owns: incident state machine, assignment, comments (spec §10.3, §12, §15).
 * Must not own vendor polling.
 *
 * Site scope note: same shape as CmdbService — `/incidents/:id` identifies
 * the resource by its own id, not a site id, so SiteScopeGuard doesn't apply
 * here either. `assertSiteAccess()` is the explicit equivalent.
 *
 * Status changes never happen here — see IncidentsTransitionService.
 */
@Injectable()
export class IncidentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly authzService: AuthzService,
  ) {}

  async assertSiteAccess(user: AuthenticatedUser, siteId: string): Promise<void> {
    const allowed = await this.authzService.canAccessSite(user, siteId);
    if (!allowed) {
      throw new ForbiddenException("You do not have access to this site");
    }
  }

  async findAll(
    query: ListIncidentsQueryDto,
    accessibleSiteIds?: string[] | null,
  ): Promise<Paginated<Incident>> {
    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;

    let siteFilter: string[] | undefined;
    if (accessibleSiteIds) {
      siteFilter =
        query.siteId && accessibleSiteIds.includes(query.siteId)
          ? [query.siteId]
          : accessibleSiteIds;
    } else if (query.siteId) {
      siteFilter = [query.siteId];
    }

    const where: Prisma.IncidentWhereInput = {
      siteId: siteFilter ? { in: siteFilter } : undefined,
      status: query.status,
      priority: query.priority,
      ownerUserId: query.ownerUserId,
      ownerGroupId: query.ownerGroupId,
      ciId: query.ciId,
      OR: query.q
        ? [
            { incidentNo: { contains: query.q, mode: "insensitive" } },
            { shortDescription: { contains: query.q, mode: "insensitive" } },
          ]
        : undefined,
    };

    const [items, total] = await Promise.all([
      this.prisma.incident.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
      }),
      this.prisma.incident.count({ where }),
    ]);

    return { items, total, limit, offset };
  }

  async findOne(id: string): Promise<Incident> {
    const incident = await this.prisma.incident.findUnique({ where: { id } });
    if (!incident) {
      throw new NotFoundException(`Incident ${id} not found`);
    }
    return incident;
  }

  async findOneScoped(id: string, user: AuthenticatedUser): Promise<Incident> {
    const incident = await this.findOne(id);
    await this.assertSiteAccess(user, incident.siteId);
    return incident;
  }

  private async nextIncidentNo(tx: Prisma.TransactionClient): Promise<string> {
    // A real sequence, not count()+1 — avoids a race under concurrent
    // incident creation producing a duplicate/failed-unique-constraint
    // number (see Sprint 4 plan, Decision 2).
    const [{ nextval }] = await tx.$queryRaw<
      { nextval: bigint }[]
    >`SELECT nextval('incident_no_seq') AS nextval`;
    return `INC-${nextval.toString().padStart(6, "0")}`;
  }

  create(dto: CreateIncidentDto, actor: ActorContext) {
    return this.prisma.$transaction(async (tx) => {
      const incidentNo = await this.nextIncidentNo(tx);
      const incident = await tx.incident.create({
        data: {
          incidentNo,
          siteId: dto.siteId,
          ciId: dto.ciId,
          category: dto.category,
          impact: dto.impact,
          urgency: dto.urgency,
          priority: dto.priority,
          shortDescription: dto.shortDescription,
        },
      });
      await tx.incidentEvent.create({
        data: {
          incidentId: incident.id,
          eventType: "CREATED",
          actorId: actor.actorId,
          payload: { status: incident.status } as Prisma.InputJsonValue,
        },
      });
      await this.auditService.record(
        {
          actorId: actor.actorId,
          entityType: "Incident",
          entityId: incident.id,
          action: "CREATE",
          after: incident,
          correlationId: actor.correlationId,
        },
        tx,
      );
      return incident;
    });
  }

  async update(id: string, dto: UpdateIncidentDto, user: AuthenticatedUser, actor: ActorContext) {
    const before = await this.findOneScoped(id, user);
    const ownerChanged =
      (dto.ownerGroupId !== undefined && dto.ownerGroupId !== before.ownerGroupId) ||
      (dto.ownerUserId !== undefined && dto.ownerUserId !== before.ownerUserId);

    return this.prisma.$transaction(async (tx) => {
      const after = await tx.incident.update({
        where: { id },
        data: {
          shortDescription: dto.shortDescription,
          category: dto.category,
          impact: dto.impact,
          urgency: dto.urgency,
          ciId: dto.ciId,
          ownerGroupId: dto.ownerGroupId,
          ownerUserId: dto.ownerUserId,
          priority: dto.priority,
        },
      });

      if (ownerChanged) {
        await tx.incidentEvent.create({
          data: {
            incidentId: id,
            eventType: "OWNER_CHANGE",
            actorId: actor.actorId,
            payload: {
              fromOwnerUserId: before.ownerUserId,
              toOwnerUserId: after.ownerUserId,
              fromOwnerGroupId: before.ownerGroupId,
              toOwnerGroupId: after.ownerGroupId,
            } as Prisma.InputJsonValue,
          },
        });
      }

      await this.auditService.record(
        {
          actorId: actor.actorId,
          entityType: "Incident",
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

  // --- Status transitions (spec §15) ----------------------------------
  //
  // The only place Incident.status ever changes. Guard/controller layer
  // handles coarse RBAC (INCIDENT_WRITE_ROLES); this method does the
  // per-transition role/ownership/field checks the rule table describes —
  // same layering CmdbService uses for site-scope (guard vs. resource check).

  async createTransition(
    id: string,
    dto: TransitionIncidentDto,
    actor: ActorContext,
    user: AuthenticatedUser,
  ) {
    const incident = await this.findOneScoped(id, user);

    const rule = findTransitionRule(incident.status, dto.toStatus);
    if (!rule) {
      throw new BadRequestException(
        `Cannot transition incident from ${incident.status} to ${dto.toStatus}`,
      );
    }

    if (!rule.allowedRoles.includes(user.role)) {
      throw new ForbiddenException(
        `Role ${user.role} cannot perform ${incident.status} -> ${dto.toStatus}`,
      );
    }

    if (rule.requiresOwnerOrElevated && !isOwnerOrElevated(user.id, user.role, incident)) {
      throw new ForbiddenException(
        "Only the assigned owner or an elevated role can perform this transition",
      );
    }

    const missing = (rule.requiredFields ?? []).filter((field) => !dto[field]);
    if (missing.length > 0) {
      throw new BadRequestException(`Missing required field(s): ${missing.join(", ")}`);
    }

    const validationError = rule.validate?.(incident, dto);
    if (validationError) {
      throw new BadRequestException(validationError);
    }

    return this.prisma.$transaction(async (tx) => {
      const data: Prisma.IncidentUncheckedUpdateInput = { status: dto.toStatus };
      if (dto.ownerGroupId !== undefined) {
        data.ownerGroupId = dto.ownerGroupId;
      }
      if (dto.ownerUserId !== undefined) {
        data.ownerUserId = dto.ownerUserId;
      }
      if (dto.toStatus === "ACKNOWLEDGED") {
        data.acknowledgedAt = new Date();
      }
      if (dto.toStatus === "RESOLVED") {
        data.resolutionCategory = dto.resolutionCategory;
        data.rootCauseSummary = dto.rootCauseSummary;
        data.restoredAt = new Date();
      }
      if (dto.toStatus === "CLOSED") {
        data.closedAt = new Date();
      }

      const after = await tx.incident.update({ where: { id }, data });

      await tx.incidentEvent.create({
        data: {
          incidentId: id,
          eventType: "STATUS_CHANGE",
          actorId: actor.actorId,
          payload: {
            from: incident.status,
            to: dto.toStatus,
            reason: dto.reason,
            resolutionCategory: dto.resolutionCategory,
            rootCauseSummary: dto.rootCauseSummary,
          } as Prisma.InputJsonValue,
        },
      });

      await this.auditService.record(
        {
          actorId: actor.actorId,
          entityType: "Incident",
          entityId: id,
          action: "TRANSITION",
          before: incident,
          after,
          correlationId: actor.correlationId,
        },
        tx,
      );

      return after;
    });
  }
}
