import { Injectable, NotFoundException } from "@nestjs/common";
import { Priority, SlaPolicy } from "@prisma/client";
import { ActorContext } from "../../common/types/actor-context.type";
import { PrismaService } from "../../common/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { SitesService } from "../sites/sites.service";
import { BusinessCalendar } from "./calendar.util";
import { CreateSlaPolicyDto } from "./dto/create-sla-policy.dto";
import { UpdateSlaPolicyDto } from "./dto/update-sla-policy.dto";

/**
 * Owns: SLA policy versions, timers, escalations (spec §10.8, §12).
 * Must not own UI-only countdowns.
 *
 * Support-calendar CRUD lives in `sites` (spec §12's ownership table:
 * "sites: ... support calendars"), not here — `resolveCalendar()` reads
 * via the already-exported `SitesService.listSupportCalendars()` rather
 * than querying the table directly, per CLAUDE.md's cross-module rule.
 */
@Injectable()
export class SlaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly sitesService: SitesService,
  ) {}

  // --- Policy CRUD (admin/contract config, spec §10.8) -------------------

  listPolicies(priority?: Priority) {
    return this.prisma.slaPolicy.findMany({
      where: priority ? { priority } : undefined,
      orderBy: [{ priority: "asc" }, { effectiveFrom: "desc" }],
    });
  }

  async findPolicy(id: string): Promise<SlaPolicy> {
    const policy = await this.prisma.slaPolicy.findUnique({ where: { id } });
    if (!policy) {
      throw new NotFoundException(`SLA policy ${id} not found`);
    }
    return policy;
  }

  createPolicy(dto: CreateSlaPolicyDto, actor: ActorContext) {
    return this.prisma.$transaction(async (tx) => {
      const policy = await tx.slaPolicy.create({
        data: {
          name: dto.name,
          priority: dto.priority,
          ackTargetMinutes: dto.ackTargetMinutes,
          resolveTargetMinutes: dto.resolveTargetMinutes,
          usesBusinessCalendar: dto.usesBusinessCalendar ?? false,
          escalationThresholdsPercent: dto.escalationThresholdsPercent ?? [50, 75, 90],
          pausesOnPendingVendor: dto.pausesOnPendingVendor ?? true,
          pausesOnPendingCustomer: dto.pausesOnPendingCustomer ?? true,
          effectiveFrom: dto.effectiveFrom,
          effectiveTo: dto.effectiveTo,
          isActive: dto.isActive ?? true,
        },
      });
      await this.auditService.record(
        {
          actorId: actor.actorId,
          entityType: "SlaPolicy",
          entityId: policy.id,
          action: "CREATE",
          after: policy,
          correlationId: actor.correlationId,
        },
        tx,
      );
      return policy;
    });
  }

  async updatePolicy(id: string, dto: UpdateSlaPolicyDto, actor: ActorContext): Promise<SlaPolicy> {
    const before = await this.findPolicy(id);
    return this.prisma.$transaction(async (tx) => {
      const after = await tx.slaPolicy.update({
        where: { id },
        data: {
          name: dto.name,
          ackTargetMinutes: dto.ackTargetMinutes,
          resolveTargetMinutes: dto.resolveTargetMinutes,
          usesBusinessCalendar: dto.usesBusinessCalendar,
          escalationThresholdsPercent: dto.escalationThresholdsPercent,
          pausesOnPendingVendor: dto.pausesOnPendingVendor,
          pausesOnPendingCustomer: dto.pausesOnPendingCustomer,
          effectiveTo: dto.effectiveTo,
          isActive: dto.isActive,
        },
      });
      await this.auditService.record(
        {
          actorId: actor.actorId,
          entityType: "SlaPolicy",
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

  // --- Resolution (used by the incident lifecycle hooks, Step 3) ---------

  /** The active policy for `priority` whose effective window contains `at`. */
  async resolvePolicy(priority: Priority, at: Date): Promise<SlaPolicy> {
    const policy = await this.prisma.slaPolicy.findFirst({
      where: {
        priority,
        isActive: true,
        effectiveFrom: { lte: at },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: at } }],
      },
      orderBy: { effectiveFrom: "desc" },
    });
    if (!policy) {
      throw new NotFoundException(`No active SLA policy configured for priority ${priority}`);
    }
    return policy;
  }

  /**
   * One calendar per site in v1 (Sprint 6 plan, Decision 3) — `null` when
   * none is configured, which callers treat as 24x7 (`addBusinessMinutes`
   * falls back to plain wall-clock addition for a null calendar).
   */
  async resolveCalendar(siteId: string): Promise<BusinessCalendar | null> {
    const calendars = await this.sitesService.listSupportCalendars(siteId);
    return calendars[0] ?? null;
  }
}
