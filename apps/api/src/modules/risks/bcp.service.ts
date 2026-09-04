import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import type { BcpPlan, Prisma } from "@prisma/client";
import { PrismaService } from "../../common/prisma/prisma.service";
import { ActorContext } from "../../common/types/actor-context.type";
import { AuditService } from "../audit/audit.service";
import { deriveBcpReadiness } from "./bcp.readiness";
import { CreateBcpPlanDto } from "./dto/create-bcp-plan.dto";
import { QueryBcpPlansDto } from "./dto/query-bcp-plans.dto";
import { RecordBcpTestDto } from "./dto/record-bcp-test.dto";
import { UpdateBcpPlanDto } from "./dto/update-bcp-plan.dto";

/**
 * Business-continuity plans (spec §10.15) — the other half of the risks
 * module's remit. A plan covers exactly one site or one named service and
 * carries the recovery strategy, RTO/RPO and the test cadence. "Readiness"
 * (untested / test overdue / ready) is derived at read time from the test
 * dates — see `bcp.readiness.ts` — not stored. Every mutation writes an audit
 * event in the same transaction as the write.
 */
@Injectable()
export class BcpService {
  private readonly logger = new Logger(BcpService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(dto: CreateBcpPlanDto, actor: ActorContext) {
    requireExactlyOneScope(dto.siteId, dto.serviceName);

    const plan = await this.prisma.$transaction(async (tx) => {
      const created = await tx.bcpPlan.create({
        data: {
          name: dto.name,
          siteId: dto.siteId ?? null,
          serviceName: dto.serviceName ?? null,
          recoveryStrategy: dto.recoveryStrategy,
          alternateSite: dto.alternateSite ?? null,
          rtoMinutes: dto.rtoMinutes,
          rpoMinutes: dto.rpoMinutes,
          targetAvailabilityPercent: dto.targetAvailabilityPercent ?? null,
          residualRisk: dto.residualRisk ?? null,
          contacts: dto.contacts ?? null,
          ownerId: dto.ownerId ?? null,
          lastTestedAt: dto.lastTestedAt ? new Date(dto.lastTestedAt) : null,
          nextTestDueAt: dto.nextTestDueAt ? new Date(dto.nextTestDueAt) : null,
        },
      });
      await this.audit.record(
        {
          actorId: actor.actorId,
          correlationId: actor.correlationId,
          entityType: "bcp_plan",
          entityId: created.id,
          action: "BCP_PLAN_CREATED",
          after: created,
        },
        tx,
      );
      return created;
    });

    return this.decorate(plan);
  }

  async list(query: QueryBcpPlansDto) {
    const now = new Date();
    const and: Prisma.BcpPlanWhereInput[] = [];

    if (query.siteId) {
      and.push({ siteId: query.siteId });
    }
    if (query.isActive !== undefined) {
      and.push({ isActive: query.isActive });
    }
    if (query.view === "due") {
      // Tested before, and the next test date has passed.
      and.push({ lastTestedAt: { not: null }, nextTestDueAt: { lt: now } });
    }

    const plans = await this.prisma.bcpPlan.findMany({
      where: and.length ? { AND: and } : {},
      orderBy: [{ nextTestDueAt: "asc" }, { createdAt: "desc" }],
      take: query.limit ?? 50,
    });
    return plans.map((plan) => this.decorate(plan, now));
  }

  async getOne(id: string) {
    return this.decorate(await this.requirePlan(id));
  }

  async update(id: string, dto: UpdateBcpPlanDto, actor: ActorContext) {
    const before = await this.requirePlan(id);

    // What a plan covers (siteId / serviceName) is fixed at creation — no
    // re-scoping through PATCH, so exactly-one-scope can't be broken here.
    const data: Prisma.BcpPlanUpdateInput = {
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.recoveryStrategy !== undefined ? { recoveryStrategy: dto.recoveryStrategy } : {}),
      ...(dto.alternateSite !== undefined ? { alternateSite: dto.alternateSite } : {}),
      ...(dto.rtoMinutes !== undefined ? { rtoMinutes: dto.rtoMinutes } : {}),
      ...(dto.rpoMinutes !== undefined ? { rpoMinutes: dto.rpoMinutes } : {}),
      ...(dto.targetAvailabilityPercent !== undefined
        ? { targetAvailabilityPercent: dto.targetAvailabilityPercent }
        : {}),
      ...(dto.residualRisk !== undefined ? { residualRisk: dto.residualRisk } : {}),
      ...(dto.contacts !== undefined ? { contacts: dto.contacts } : {}),
      ...(dto.ownerId !== undefined ? { ownerId: dto.ownerId } : {}),
      ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      ...(dto.nextTestDueAt !== undefined ? { nextTestDueAt: new Date(dto.nextTestDueAt) } : {}),
    };

    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.bcpPlan.update({ where: { id }, data });
      await this.audit.record(
        {
          actorId: actor.actorId,
          correlationId: actor.correlationId,
          entityType: "bcp_plan",
          entityId: id,
          action: "BCP_PLAN_UPDATED",
          before,
          after: u,
        },
        tx,
      );
      return u;
    });

    return this.decorate(updated);
  }

  async recordTest(id: string, dto: RecordBcpTestDto, actor: ActorContext) {
    const before = await this.requirePlan(id);
    const testedAt = dto.testedAt ? new Date(dto.testedAt) : new Date();

    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.bcpPlan.update({
        where: { id },
        data: {
          lastTestedAt: testedAt,
          ...(dto.nextTestDueAt !== undefined
            ? { nextTestDueAt: new Date(dto.nextTestDueAt) }
            : {}),
        },
      });
      await this.audit.record(
        {
          actorId: actor.actorId,
          correlationId: actor.correlationId,
          entityType: "bcp_plan",
          entityId: id,
          action: "BCP_PLAN_TESTED",
          before: { lastTestedAt: before.lastTestedAt, nextTestDueAt: before.nextTestDueAt },
          after: {
            lastTestedAt: u.lastTestedAt,
            nextTestDueAt: u.nextTestDueAt,
            notes: dto.notes ?? null,
          },
        },
        tx,
      );
      return u;
    });

    return this.decorate(updated);
  }

  private async requirePlan(id: string): Promise<BcpPlan> {
    const plan = await this.prisma.bcpPlan.findUnique({ where: { id } });
    if (!plan) {
      throw new NotFoundException(`BCP plan ${id} not found`);
    }
    return plan;
  }

  private decorate(plan: BcpPlan, now?: Date) {
    return { ...plan, ...deriveBcpReadiness(plan, now) };
  }
}

/** A plan covers a site XOR a service — never both, never neither (spec §10.15). */
function requireExactlyOneScope(siteId?: string, serviceName?: string): void {
  if (Boolean(siteId) === Boolean(serviceName)) {
    throw new BadRequestException("Set exactly one of siteId or serviceName");
  }
}
