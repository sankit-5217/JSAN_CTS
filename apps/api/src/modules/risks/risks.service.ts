import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { NotificationsPublisher } from "../../common/notifications/notifications.publisher";
import { PrismaService } from "../../common/prisma/prisma.service";
import { ActorContext } from "../../common/types/actor-context.type";
import { AuditService } from "../audit/audit.service";
import type { RiskStatus } from "./risks.constants";
import { computeRiskScore, deriveRiskView, scoreRangeForSeverity } from "./risks.scoring";
import { allowedRiskTransitions, canTransitionRiskStatus } from "./risks.transitions";
import { ChangeRiskStatusDto } from "./dto/change-risk-status.dto";
import { CreateRiskDto } from "./dto/create-risk.dto";
import { QueryRisksDto } from "./dto/query-risks.dto";
import { UpdateRiskDto } from "./dto/update-risk.dto";

/**
 * Owns: the risk register (spec §10.15, §12). `score` is computed here
 * (likelihood × impact), never taken from the client; `severity` / `overdue`
 * are derived at read time (`risks.scoring.ts`). Must not own: ticket state — a
 * risk only references a site by id.
 *
 * BCP records (RTO/RPO/alternate site/test dates) are also this module's remit
 * but need a `bcp_plans` table first — not in the schema yet (coordinate with
 * Dev A before adding it).
 */
@Injectable()
export class RisksService {
  private readonly logger = new Logger(RisksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsPublisher,
  ) {}

  async create(dto: CreateRiskDto, actor: ActorContext) {
    const score = computeRiskScore(dto.likelihood, dto.impact);

    const risk = await this.prisma.$transaction(async (tx) => {
      const created = await tx.risk.create({
        data: {
          description: dto.description,
          likelihood: dto.likelihood,
          impact: dto.impact,
          score,
          ...(dto.mitigation !== undefined ? { mitigation: dto.mitigation } : {}),
          ...(dto.ownerId !== undefined ? { ownerId: dto.ownerId } : {}),
          ...(dto.siteId !== undefined ? { siteId: dto.siteId } : {}),
          ...(dto.dueDate !== undefined ? { dueDate: new Date(dto.dueDate) } : {}),
        },
      });
      await this.audit.record(
        {
          actorId: actor.actorId,
          correlationId: actor.correlationId,
          entityType: "risk",
          entityId: created.id,
          action: "RISK_REGISTERED",
          after: created,
        },
        tx,
      );
      return created;
    });

    return this.decorate(risk);
  }

  async list(query: QueryRisksDto) {
    const now = new Date();
    // AND-array: `status` and the `overdue` view can both constrain `status`.
    const and: Prisma.RiskWhereInput[] = [];

    if (query.status) {
      and.push({ status: query.status });
    }
    if (query.siteId) {
      and.push({ siteId: query.siteId });
    }
    if (query.ownerId) {
      and.push({ ownerId: query.ownerId });
    }
    if (query.severity) {
      const range = scoreRangeForSeverity(query.severity);
      and.push({ score: { gte: range.min, lte: range.max } });
    }
    if (query.view === "overdue") {
      and.push({ dueDate: { lt: now } });
      if (!query.status) {
        and.push({ status: { not: "CLOSED" } });
      }
    }

    const risks = await this.prisma.risk.findMany({
      where: and.length ? { AND: and } : {},
      orderBy: [{ score: "desc" }, { dueDate: "asc" }],
      take: query.limit ?? 50,
    });
    return risks.map((risk) => this.decorate(risk, now));
  }

  async getOne(id: string) {
    return this.decorate(await this.requireRisk(id));
  }

  async update(id: string, dto: UpdateRiskDto, actor: ActorContext) {
    const before = await this.requireRisk(id);

    const scoreChanged = dto.likelihood !== undefined || dto.impact !== undefined;
    const data: Prisma.RiskUpdateInput = {
      ...(dto.description !== undefined ? { description: dto.description } : {}),
      ...(dto.likelihood !== undefined ? { likelihood: dto.likelihood } : {}),
      ...(dto.impact !== undefined ? { impact: dto.impact } : {}),
      ...(dto.mitigation !== undefined ? { mitigation: dto.mitigation } : {}),
      ...(dto.ownerId !== undefined ? { ownerId: dto.ownerId } : {}),
      ...(dto.siteId !== undefined ? { siteId: dto.siteId } : {}),
      ...(dto.dueDate !== undefined ? { dueDate: new Date(dto.dueDate) } : {}),
      ...(scoreChanged
        ? {
            score: computeRiskScore(
              dto.likelihood ?? before.likelihood,
              dto.impact ?? before.impact,
            ),
          }
        : {}),
    };

    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.risk.update({ where: { id }, data });
      await this.audit.record(
        {
          actorId: actor.actorId,
          correlationId: actor.correlationId,
          entityType: "risk",
          entityId: id,
          action: "RISK_UPDATED",
          before,
          after: u,
        },
        tx,
      );
      return u;
    });

    return this.decorate(updated);
  }

  async changeStatus(id: string, dto: ChangeRiskStatusDto, actor: ActorContext) {
    const risk = await this.requireRisk(id);
    const from = risk.status as RiskStatus;
    const to = dto.status;

    if (!canTransitionRiskStatus(from, to)) {
      const allowed = allowedRiskTransitions(from);
      throw new ConflictException(
        `Cannot move risk ${id} from ${from} to ${to}; allowed: ${
          allowed.length ? allowed.join(", ") : "none"
        }`,
      );
    }

    const effectiveMitigation = dto.mitigation ?? risk.mitigation ?? null;
    if ((to === "MITIGATING" || to === "ACCEPTED") && !effectiveMitigation) {
      throw new BadRequestException(
        `Moving a risk to ${to} requires a documented mitigation / rationale`,
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.risk.update({
        where: { id },
        data: {
          status: to,
          ...(dto.mitigation !== undefined ? { mitigation: dto.mitigation } : {}),
        },
      });
      await this.audit.record(
        {
          actorId: actor.actorId,
          correlationId: actor.correlationId,
          entityType: "risk",
          entityId: id,
          action: "RISK_STATUS_CHANGED",
          before: { status: from, mitigation: risk.mitigation },
          after: { status: to, mitigation: u.mitigation },
        },
        tx,
      );
      return u;
    });

    await this.notifyOwnerOfStatusChange(updated, from, to);
    return this.decorate(updated);
  }

  /** Best-effort: tell the risk owner their risk moved. Swallows every failure —
   *  the mutation already committed, notification must not block or fail it. */
  private async notifyOwnerOfStatusChange(
    risk: { id: string; ownerId: string | null; description: string; mitigation: string | null },
    from: RiskStatus,
    to: RiskStatus,
  ): Promise<void> {
    try {
      if (!risk.ownerId) {
        return;
      }
      const owner = await this.prisma.user.findUnique({ where: { id: risk.ownerId } });
      if (!owner?.email) {
        return;
      }
      await this.notifications.enqueue(
        {
          event: {
            kind: "RISK_STATUS_CHANGED",
            entity: {
              key: `RISK-${risk.id.slice(0, 8)}`,
              title: risk.description.slice(0, 120),
            },
            from,
            to,
            ...(risk.mitigation ? { note: risk.mitigation } : {}),
          },
          recipients: { to: [{ name: owner.displayName, email: owner.email }] },
        },
        `RISK_STATUS_CHANGED:${risk.id}:${to}`,
      );
    } catch (err) {
      this.logger.warn(
        `risk ${risk.id} owner notification skipped: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async requireRisk(id: string) {
    const risk = await this.prisma.risk.findUnique({ where: { id } });
    if (!risk) {
      throw new NotFoundException(`Risk ${id} not found`);
    }
    return risk;
  }

  private decorate<T extends Parameters<typeof deriveRiskView>[0]>(risk: T, now?: Date) {
    return { ...risk, ...deriveRiskView(risk, now) };
  }
}
