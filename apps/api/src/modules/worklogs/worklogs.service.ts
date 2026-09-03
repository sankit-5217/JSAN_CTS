import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, Worklog } from "@prisma/client";
import { ActorContext } from "../../common/types/actor-context.type";
import { PrismaService } from "../../common/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { AuthenticatedUser } from "../auth/types/jwt-payload.type";
import { ELEVATED_ROLES } from "../incidents/incident-transitions";
import { IncidentsService } from "../incidents/incidents.service";
import { CorrectWorklogDto } from "./dto/correct-worklog.dto";
import { CreateWorklogDto } from "./dto/create-worklog.dto";

/**
 * Owns: engineer activity and time corrections (spec §10.7, §12).
 * Must not own authentication.
 *
 * Site scope is delegated to IncidentsService.findOneScoped() rather than
 * duplicated here — a worklog's site access is entirely defined by its
 * parent incident's site, and IncidentsService already exports exactly
 * that check (CLAUDE.md: cross-module calls go through service
 * interfaces, not duplicated DB logic).
 */
@Injectable()
export class WorklogsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly incidentsService: IncidentsService,
  ) {}

  /**
   * Derived server-side, never client-supplied (spec §10.7: "Derived by
   * backend; no negative duration"). Returns null while the activity is
   * still in progress (no endedAt yet).
   */
  private computeDurationMinutes(startedAt: Date, endedAt?: Date | null): number | null {
    if (!endedAt) {
      return null;
    }
    const ms = endedAt.getTime() - startedAt.getTime();
    if (ms < 0) {
      throw new BadRequestException("endedAt must not be before startedAt");
    }
    return Math.round(ms / 60000);
  }

  async findWorklogScoped(id: string, user: AuthenticatedUser): Promise<Worklog> {
    const worklog = await this.prisma.worklog.findUnique({ where: { id } });
    if (!worklog) {
      throw new NotFoundException(`Worklog ${id} not found`);
    }
    // Reuses IncidentsService's own site-access check on the parent incident.
    await this.incidentsService.findOneScoped(worklog.incidentId, user);
    return worklog;
  }

  async listByIncident(incidentId: string, user: AuthenticatedUser): Promise<Worklog[]> {
    await this.incidentsService.findOneScoped(incidentId, user);
    return this.prisma.worklog.findMany({
      where: { incidentId },
      orderBy: { startedAt: "asc" },
    });
  }

  async create(
    incidentId: string,
    dto: CreateWorklogDto,
    actor: ActorContext,
    user: AuthenticatedUser,
  ): Promise<Worklog> {
    await this.incidentsService.findOneScoped(incidentId, user);
    const durationMinutes = this.computeDurationMinutes(dto.startedAt, dto.endedAt);

    return this.prisma.$transaction(async (tx) => {
      const worklog = await tx.worklog.create({
        data: {
          incidentId,
          engineerId: actor.actorId,
          activityType: dto.activityType,
          startedAt: dto.startedAt,
          endedAt: dto.endedAt,
          durationMinutes,
          notes: dto.notes,
          billable: dto.billable,
        },
      });

      await tx.incidentEvent.create({
        data: {
          incidentId,
          eventType: "WORKLOG",
          actorId: actor.actorId,
          payload: {
            action: "CREATE",
            worklogId: worklog.id,
            activityType: worklog.activityType,
            durationMinutes: worklog.durationMinutes,
          } as Prisma.InputJsonValue,
        },
      });

      await this.auditService.record(
        {
          actorId: actor.actorId,
          entityType: "Worklog",
          entityId: worklog.id,
          action: "CREATE",
          after: worklog,
          correlationId: actor.correlationId,
        },
        tx,
      );

      return worklog;
    });
  }

  /**
   * A correction, not a free edit — spec §10.7: "Do not implement a simple
   * mutable stopwatch. Operational evidence must preserve who changed
   * time, from what value, to what value, when, and why." That guarantee
   * comes from AuditService.record()'s before/after diff, the same
   * mechanism every other module's update() already relies on — not from
   * inventing a second, parallel append-only log for this one entity.
   */
  async correct(
    id: string,
    dto: CorrectWorklogDto,
    actor: ActorContext,
    user: AuthenticatedUser,
  ): Promise<Worklog> {
    const before = await this.findWorklogScoped(id, user);

    const isOwner = before.engineerId === actor.actorId;
    const isElevated = ELEVATED_ROLES.includes(user.role);
    if (!isOwner && !isElevated) {
      throw new ForbiddenException(
        "Only the engineer who logged this worklog, or an elevated role, can correct it",
      );
    }

    const startedAt = dto.startedAt ?? before.startedAt;
    const endedAt = dto.endedAt ?? before.endedAt;
    const durationMinutes = this.computeDurationMinutes(startedAt, endedAt);

    return this.prisma.$transaction(async (tx) => {
      const after = await tx.worklog.update({
        where: { id },
        data: {
          activityType: dto.activityType,
          startedAt: dto.startedAt,
          endedAt: dto.endedAt,
          durationMinutes,
          notes: dto.notes,
          billable: dto.billable,
          editReason: dto.editReason,
        },
      });

      await tx.incidentEvent.create({
        data: {
          incidentId: before.incidentId,
          eventType: "WORKLOG",
          actorId: actor.actorId,
          payload: {
            action: "CORRECTION",
            worklogId: id,
            editReason: dto.editReason,
          } as Prisma.InputJsonValue,
        },
      });

      await this.auditService.record(
        {
          actorId: actor.actorId,
          entityType: "Worklog",
          entityId: id,
          action: "CORRECT",
          before,
          after,
          correlationId: actor.correlationId,
        },
        tx,
      );

      return after;
    });
  }
}
