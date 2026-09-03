import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../../common/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import type { ChangeStatus } from "./changes.constants";
import { deriveChangeStatus, isEditable, isPirOverdue } from "./changes.status";
import { ApproveChangeDto } from "./dto/approve-change.dto";
import { CreateChangeDto } from "./dto/create-change.dto";
import { QueryChangesDto } from "./dto/query-changes.dto";
import { UpdateChangeDto } from "./dto/update-change.dto";

const NOT_COMPLETED: Prisma.ChangeWhereInput = { OR: [{ outcome: null }, { outcome: "" }] };

function whereForStatus(status: ChangeStatus, now: Date): Prisma.ChangeWhereInput {
  switch (status) {
    case "COMPLETED":
      return { NOT: NOT_COMPLETED };
    case "PENDING_APPROVAL":
      return { approverId: null, ...NOT_COMPLETED };
    case "SCHEDULED":
      return { approverId: { not: null }, windowStart: { gt: now }, ...NOT_COMPLETED };
    case "IN_PROGRESS":
      return {
        approverId: { not: null },
        windowStart: { lte: now },
        windowEnd: { gte: now },
        ...NOT_COMPLETED,
      };
    case "PENDING_REVIEW":
      return { approverId: { not: null }, windowEnd: { lt: now }, ...NOT_COMPLETED };
    default:
      return {};
  }
}

/**
 * Owns: change workflow and maintenance windows (spec §10.6, §12). Status is
 * derived (no status column). Must not own: monitoring storage; and must not set
 * incident state — a maintenance window only informs alert handling.
 */
@Injectable()
export class ChangesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(dto: CreateChangeDto) {
    const windowStart = new Date(dto.windowStart);
    const windowEnd = new Date(dto.windowEnd);
    if (windowEnd.getTime() <= windowStart.getTime()) {
      throw new BadRequestException("windowEnd must be after windowStart");
    }

    const change = await this.prisma.$transaction(async (tx) => {
      const created = await tx.change.create({
        data: {
          changeType: dto.changeType,
          reason: dto.reason,
          implementationPlan: dto.implementationPlan,
          rollbackPlan: dto.rollbackPlan,
          risk: dto.risk,
          windowStart,
          windowEnd,
        },
      });
      await this.audit.record(
        {
          actorId: this.actorId(),
          entityType: "change",
          entityId: created.id,
          action: "CHANGE_CREATED",
          after: created,
        },
        tx,
      );
      return created;
    });
    return this.decorate(change);
  }

  async list(query: QueryChangesDto) {
    const now = new Date();
    const activeAt = query.activeAt ? new Date(query.activeAt) : undefined;

    const changes = await this.prisma.change.findMany({
      where: {
        ...(query.changeType ? { changeType: query.changeType } : {}),
        ...(query.status ? whereForStatus(query.status, now) : {}),
        ...(activeAt ? { windowStart: { lte: activeAt }, windowEnd: { gte: activeAt } } : {}),
      },
      orderBy: { windowStart: "desc" },
      take: query.limit ?? 50,
    });
    return changes.map((change) => this.decorate(change, now));
  }

  async getOne(id: string) {
    const change = await this.prisma.change.findUnique({ where: { id } });
    if (!change) {
      throw new NotFoundException(`Change ${id} not found`);
    }
    return this.decorate(change);
  }

  async approve(id: string, dto: ApproveChangeDto) {
    const change = await this.requireChange(id);
    if (change.approverId) {
      throw new ConflictException(`Change ${id} is already approved`);
    }
    if (Date.now() > change.windowEnd.getTime()) {
      throw new BadRequestException(`Change ${id} window has already ended`);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.change.update({
        where: { id },
        data: { approverId: dto.approverId },
      });
      await this.audit.record(
        {
          actorId: this.actorId(),
          entityType: "change",
          entityId: id,
          action: "CHANGE_APPROVED",
          before: { approverId: change.approverId },
          after: { approverId: u.approverId },
        },
        tx,
      );
      return u;
    });
    return this.decorate(updated);
  }

  async update(id: string, dto: UpdateChangeDto) {
    const change = await this.requireChange(id);
    const now = new Date();
    const status = deriveChangeStatus(change, now);

    if (status === "COMPLETED") {
      throw new ConflictException(`Change ${id} is completed`);
    }

    const editsPlan =
      dto.reason !== undefined ||
      dto.implementationPlan !== undefined ||
      dto.rollbackPlan !== undefined ||
      dto.risk !== undefined ||
      dto.windowStart !== undefined ||
      dto.windowEnd !== undefined;

    if (editsPlan && !isEditable(status)) {
      throw new ConflictException(
        `Change ${id} is ${status}; plan and window can only change before work starts`,
      );
    }

    const windowStart = dto.windowStart ? new Date(dto.windowStart) : change.windowStart;
    const windowEnd = dto.windowEnd ? new Date(dto.windowEnd) : change.windowEnd;
    if (windowEnd.getTime() <= windowStart.getTime()) {
      throw new BadRequestException("windowEnd must be after windowStart");
    }

    if (dto.outcome !== undefined && now.getTime() < change.windowStart.getTime()) {
      throw new BadRequestException("outcome cannot be recorded before the change window begins");
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.change.update({
        where: { id },
        data: {
          ...(dto.reason !== undefined ? { reason: dto.reason } : {}),
          ...(dto.implementationPlan !== undefined
            ? { implementationPlan: dto.implementationPlan }
            : {}),
          ...(dto.rollbackPlan !== undefined ? { rollbackPlan: dto.rollbackPlan } : {}),
          ...(dto.risk !== undefined ? { risk: dto.risk } : {}),
          ...(dto.windowStart ? { windowStart } : {}),
          ...(dto.windowEnd ? { windowEnd } : {}),
          ...(dto.outcome !== undefined ? { outcome: dto.outcome } : {}),
        },
      });
      await this.audit.record(
        {
          actorId: this.actorId(),
          entityType: "change",
          entityId: id,
          action: "CHANGE_UPDATED",
          before: change,
          after: u,
        },
        tx,
      );
      return u;
    });
    return this.decorate(updated);
  }

  /**
   * Approved, not-yet-reviewed changes whose window covers `at` (default now).
   * The feed the alert pipeline / collector uses to suppress or annotate the
   * monitoring noise a planned change is expected to generate.
   */
  async getActiveMaintenanceWindows(at: Date = new Date()) {
    const changes = await this.prisma.change.findMany({
      where: {
        approverId: { not: null },
        windowStart: { lte: at },
        windowEnd: { gte: at },
        ...NOT_COMPLETED,
      },
      orderBy: { windowEnd: "asc" },
    });
    return changes.map((change) => this.decorate(change, at));
  }

  private async requireChange(id: string) {
    const change = await this.prisma.change.findUnique({ where: { id } });
    if (!change) {
      throw new NotFoundException(`Change ${id} not found`);
    }
    return change;
  }

  private decorate<T extends Parameters<typeof deriveChangeStatus>[0]>(change: T, now?: Date) {
    return {
      ...change,
      status: deriveChangeStatus(change, now),
      pirOverdue: isPirOverdue(change, now),
    };
  }

  /**
   * Acting user id for the audit trail. Null until an auth guard is on the
   * changes controller (spec §4) — then this returns `@CurrentUser().sub`.
   */
  private actorId(): string | null {
    return null;
  }
}
