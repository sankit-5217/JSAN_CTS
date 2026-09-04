import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import type { Prisma, Problem } from "@prisma/client";
import { PrismaService } from "../../common/prisma/prisma.service";
import { ActorContext } from "../../common/types/actor-context.type";
import { AuditService } from "../audit/audit.service";
import { ChangesService } from "../changes/changes.service";
import { IncidentsService } from "../incidents/incidents.service";
import { AddActionItemDto } from "./dto/add-action-item.dto";
import { CreateProblemDto } from "./dto/create-problem.dto";
import { LinkProblemDto } from "./dto/link-problem.dto";
import { QueryProblemsDto } from "./dto/query-problems.dto";
import { TransitionProblemDto } from "./dto/transition-problem.dto";
import { UpdateProblemDto } from "./dto/update-problem.dto";
import { canTransitionProblem, requiredFieldsForProblemStatus } from "./problems.transitions";

/**
 * Owns: problem / RCA records, their action items and their links to related
 * incidents / changes (spec §10.5, §12). Must not own incident creation or
 * state — closing an incident never touches a problem, and a link is a plain
 * join row this module keeps, never a write to another module's table.
 */
@Injectable()
export class ProblemsService {
  private readonly logger = new Logger(ProblemsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly incidents: IncidentsService,
    private readonly changes: ChangesService,
  ) {}

  async create(dto: CreateProblemDto, actor: ActorContext): Promise<Problem> {
    return this.prisma.$transaction(async (tx) => {
      const problemNo = await nextProblemNo(tx);
      const problem = await tx.problem.create({
        data: {
          problemNo,
          title: dto.title,
          symptoms: dto.symptoms,
          priority: dto.priority ?? null,
          knownError: dto.knownError ?? null,
          ownerUserId: dto.ownerUserId ?? null,
          dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
        },
      });
      await this.audit.record(
        {
          actorId: actor.actorId,
          correlationId: actor.correlationId,
          entityType: "problem",
          entityId: problem.id,
          action: "PROBLEM_CREATED",
          after: problem,
        },
        tx,
      );
      return problem;
    });
  }

  list(query: QueryProblemsDto) {
    return this.prisma.problem.findMany({
      where: {
        ...(query.status ? { status: query.status } : {}),
        ...(query.ownerUserId ? { ownerUserId: query.ownerUserId } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: query.limit ?? 50,
    });
  }

  async getOne(id: string) {
    const problem = await this.prisma.problem.findUnique({
      where: { id },
      include: {
        actionItems: { orderBy: { createdAt: "asc" } },
        links: { orderBy: { createdAt: "asc" } },
      },
    });
    if (!problem) {
      throw new NotFoundException(`Problem ${id} not found`);
    }
    return problem;
  }

  async update(id: string, dto: UpdateProblemDto, actor: ActorContext): Promise<Problem> {
    const before = await this.findOrThrow(id);
    return this.prisma.$transaction(async (tx) => {
      const after = await tx.problem.update({
        where: { id },
        data: {
          title: dto.title,
          priority: dto.priority,
          symptoms: dto.symptoms,
          knownError: dto.knownError,
          rootCause: dto.rootCause,
          correctiveAction: dto.correctiveAction,
          preventiveAction: dto.preventiveAction,
          ownerUserId: dto.ownerUserId,
          dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
        },
      });
      await this.audit.record(
        {
          actorId: actor.actorId,
          correlationId: actor.correlationId,
          entityType: "problem",
          entityId: id,
          action: "PROBLEM_UPDATED",
          before,
          after,
        },
        tx,
      );
      return after;
    });
  }

  async transition(id: string, dto: TransitionProblemDto, actor: ActorContext): Promise<Problem> {
    const problem = await this.findOrThrow(id);

    if (problem.status === dto.toStatus) {
      throw new BadRequestException(`Problem is already ${dto.toStatus}`);
    }
    if (!canTransitionProblem(problem.status, dto.toStatus)) {
      throw new BadRequestException(
        `Cannot move a problem from ${problem.status} to ${dto.toStatus}`,
      );
    }
    const missing = requiredFieldsForProblemStatus(dto.toStatus).filter(
      (field) => !problem[field as keyof Problem],
    );
    if (missing.length > 0) {
      throw new BadRequestException(`Set ${missing.join(", ")} before moving to ${dto.toStatus}`);
    }

    return this.prisma.$transaction(async (tx) => {
      const after = await tx.problem.update({
        where: { id },
        data: {
          status: dto.toStatus,
          resolvedAt: dto.toStatus === "RESOLVED" ? new Date() : problem.resolvedAt,
          closedAt: dto.toStatus === "CLOSED" ? new Date() : problem.closedAt,
        },
      });
      await this.audit.record(
        {
          actorId: actor.actorId,
          correlationId: actor.correlationId,
          entityType: "problem",
          entityId: id,
          action: "PROBLEM_STATUS_CHANGED",
          before: { status: problem.status },
          after: { status: after.status, reason: dto.reason ?? null },
        },
        tx,
      );
      return after;
    });
  }

  async addActionItem(id: string, dto: AddActionItemDto, actor: ActorContext) {
    await this.findOrThrow(id);
    return this.prisma.$transaction(async (tx) => {
      const item = await tx.problemActionItem.create({
        data: {
          problemId: id,
          description: dto.description,
          assigneeUserId: dto.assigneeUserId ?? null,
          dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
        },
      });
      await this.audit.record(
        {
          actorId: actor.actorId,
          correlationId: actor.correlationId,
          entityType: "problem",
          entityId: id,
          action: "PROBLEM_ACTION_ITEM_ADDED",
          after: item,
        },
        tx,
      );
      return item;
    });
  }

  async completeActionItem(id: string, itemId: string, actor: ActorContext) {
    const item = await this.prisma.problemActionItem.findUnique({ where: { id: itemId } });
    if (!item || item.problemId !== id) {
      throw new NotFoundException(`Action item ${itemId} not found on problem ${id}`);
    }
    if (item.completedAt) {
      return item;
    }
    return this.prisma.$transaction(async (tx) => {
      const done = await tx.problemActionItem.update({
        where: { id: itemId },
        data: { completedAt: new Date() },
      });
      await this.audit.record(
        {
          actorId: actor.actorId,
          correlationId: actor.correlationId,
          entityType: "problem",
          entityId: id,
          action: "PROBLEM_ACTION_ITEM_COMPLETED",
          after: done,
        },
        tx,
      );
      return done;
    });
  }

  async link(id: string, dto: LinkProblemDto, actor: ActorContext) {
    await this.findOrThrow(id);

    // Existence check goes through the owning module's service, never its table.
    if (dto.entityType === "INCIDENT") {
      await this.incidents.findOne(dto.entityId);
    } else {
      await this.changes.getOne(dto.entityId);
    }

    const existing = await this.prisma.problemLink.findUnique({
      where: {
        problemId_entityType_entityId: {
          problemId: id,
          entityType: dto.entityType,
          entityId: dto.entityId,
        },
      },
    });
    if (existing) {
      throw new ConflictException(`That ${dto.entityType.toLowerCase()} is already linked`);
    }

    return this.prisma.$transaction(async (tx) => {
      const created = await tx.problemLink.create({
        data: { problemId: id, entityType: dto.entityType, entityId: dto.entityId },
      });
      await this.audit.record(
        {
          actorId: actor.actorId,
          correlationId: actor.correlationId,
          entityType: "problem",
          entityId: id,
          action: "PROBLEM_LINKED",
          after: created,
        },
        tx,
      );
      return created;
    });
  }

  async unlink(id: string, linkId: string, actor: ActorContext) {
    const link = await this.prisma.problemLink.findUnique({ where: { id: linkId } });
    if (!link || link.problemId !== id) {
      throw new NotFoundException(`Link ${linkId} not found on problem ${id}`);
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.problemLink.delete({ where: { id: linkId } });
      await this.audit.record(
        {
          actorId: actor.actorId,
          correlationId: actor.correlationId,
          entityType: "problem",
          entityId: id,
          action: "PROBLEM_UNLINKED",
          before: link,
        },
        tx,
      );
    });
  }

  private async findOrThrow(id: string): Promise<Problem> {
    const problem = await this.prisma.problem.findUnique({ where: { id } });
    if (!problem) {
      throw new NotFoundException(`Problem ${id} not found`);
    }
    return problem;
  }
}

async function nextProblemNo(tx: Prisma.TransactionClient): Promise<string> {
  // Real sequence, not count()+1 — same race-safe numbering as incidents.
  const [{ nextval }] = await tx.$queryRaw<
    { nextval: bigint }[]
  >`SELECT nextval('problem_no_seq') AS nextval`;
  return `PRB-${nextval.toString().padStart(6, "0")}`;
}
