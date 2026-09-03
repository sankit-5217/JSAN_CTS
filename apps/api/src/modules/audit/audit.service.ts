import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../common/prisma/prisma.service";

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
}
