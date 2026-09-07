import { Injectable } from "@nestjs/common";
import { AuditEvent, Prisma } from "@prisma/client";
import { Paginated } from "../../common/types/paginated.type";
import { PrismaService } from "../../common/prisma/prisma.service";
import { ListAuditEventsQueryDto } from "./dto/list-audit-events-query.dto";

export interface RecordAuditEventInput {
  actorId?: string | null;
  entityType: string;
  entityId: string;
  action: string;
  before?: unknown;
  after?: unknown;
  correlationId?: string | null;
}

/**
 * Append-only audit trail (spec §12, §17). Every mutation in every module
 * calls `record()` in the *same Prisma transaction* as the mutation
 * itself (pass the transaction client as `tx`) — "audit everything" is a
 * hard guarantee, not best-effort, so if the audit write fails the whole
 * mutation rolls back rather than silently succeeding with no trail.
 * Never update or delete a row here — corrections are a new event, same
 * as the spec's rule for worklog corrections (§10.7).
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(
    input: RecordAuditEventInput,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<void> {
    await tx.auditEvent.create({
      data: {
        actorId: input.actorId ?? undefined,
        entityType: input.entityType,
        entityId: input.entityId,
        action: input.action,
        before: (input.before as Prisma.InputJsonValue) ?? undefined,
        after: (input.after as Prisma.InputJsonValue) ?? undefined,
        correlationId: input.correlationId ?? undefined,
      },
    });
  }

  /**
   * Authorized audit search (spec §14.1) — reconstructs an entity's or
   * actor's timeline. Role-gated in AuditController, not here (same split
   * as CmdbService/CisController's managementAddress redaction: this
   * service is the plain data-access layer).
   */
  async findAll(query: ListAuditEventsQueryDto): Promise<Paginated<AuditEvent>> {
    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;

    const where: Prisma.AuditEventWhereInput = {
      entityType: query.entityType,
      entityId: query.entityId,
      actorId: query.actorId,
      action: query.action,
      createdAt:
        query.from || query.to
          ? {
              gte: query.from ? new Date(query.from) : undefined,
              lte: query.to ? new Date(query.to) : undefined,
            }
          : undefined,
    };

    const [items, total] = await Promise.all([
      this.prisma.auditEvent.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
      }),
      this.prisma.auditEvent.count({ where }),
    ]);

    return { items, total, limit, offset };
  }
}
