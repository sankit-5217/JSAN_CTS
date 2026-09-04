import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, Priority, SlaInstance, SlaPolicy } from "@prisma/client";
import { ActorContext } from "../../common/types/actor-context.type";
import { PrismaService } from "../../common/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { SitesService } from "../sites/sites.service";
import { addBusinessMinutes, BusinessCalendar } from "./calendar.util";
import { CreateSlaPolicyDto } from "./dto/create-sla-policy.dto";
import { UpdateSlaPolicyDto } from "./dto/update-sla-policy.dto";

/** The subset of Incident the lifecycle hooks need — never the full row. */
export interface IncidentSlaContext {
  id: string;
  siteId: string;
}

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

  /** `usesBusinessCalendar: false` means plain 24x7 (P1's "Typically 24x7" clock). */
  private async computeDueDates(
    siteId: string,
    policy: SlaPolicy,
    from: Date,
  ): Promise<{ ackDueAt: Date; resolveDueAt: Date }> {
    const site = await this.prisma.site.findUnique({ where: { id: siteId }, select: { timezone: true } });
    const timezone = site?.timezone ?? "UTC";
    const calendar = policy.usesBusinessCalendar ? await this.resolveCalendar(siteId) : null;
    return {
      ackDueAt: addBusinessMinutes(calendar, timezone, from, policy.ackTargetMinutes),
      resolveDueAt: addBusinessMinutes(calendar, timezone, from, policy.resolveTargetMinutes),
    };
  }

  // --- Incident lifecycle hooks (spec §10.8) ------------------------------
  //
  // Called from IncidentsService, inside the *same* transaction as the
  // incident write (`tx`), so an SLA-instance write never commits without
  // its triggering incident change, or vice versa. Each is a defensive
  // no-op if the expected precondition doesn't hold (e.g. already acked) —
  // IncidentsService's transition rules should never call one out of
  // order, but a hook silently no-op-ing beats it corrupting state.

  /** Called from `IncidentsService.create()`. */
  async startForIncident(
    tx: Prisma.TransactionClient,
    incident: IncidentSlaContext,
    priority: Priority,
    actor: ActorContext,
  ): Promise<SlaInstance> {
    const now = new Date();
    const policy = await this.resolvePolicy(priority, now);
    const dueDates = await this.computeDueDates(incident.siteId, policy, now);

    const created = await tx.slaInstance.create({
      data: {
        incidentId: incident.id,
        slaPolicyId: policy.id,
        ackDueAt: dueDates.ackDueAt,
        resolveDueAt: dueDates.resolveDueAt,
      },
    });

    await this.auditService.record(
      {
        actorId: actor.actorId,
        entityType: "SlaInstance",
        entityId: created.id,
        action: "CREATE",
        after: created,
        correlationId: actor.correlationId,
      },
      tx,
    );

    return created;
  }

  private async findInstance(
    tx: Prisma.TransactionClient,
    incidentId: string,
  ): Promise<SlaInstance | null> {
    return tx.slaInstance.findFirst({ where: { incidentId } });
  }

  /** Called when a transition sets `toStatus === "ACKNOWLEDGED"`. */
  async onAcknowledged(
    tx: Prisma.TransactionClient,
    incidentId: string,
    ackedAt: Date,
    actor: ActorContext,
  ): Promise<void> {
    const before = await this.findInstance(tx, incidentId);
    if (!before || before.ackedAt) {
      return;
    }
    const after = await tx.slaInstance.update({ where: { id: before.id }, data: { ackedAt } });
    await this.auditService.record(
      {
        actorId: actor.actorId,
        entityType: "SlaInstance",
        entityId: before.id,
        action: "ACK",
        before,
        after,
        correlationId: actor.correlationId,
      },
      tx,
    );
  }

  /** Called when a transition sets `toStatus === "RESOLVED"`. */
  async onResolved(
    tx: Prisma.TransactionClient,
    incidentId: string,
    resolvedAt: Date,
    actor: ActorContext,
  ): Promise<void> {
    const before = await this.findInstance(tx, incidentId);
    if (!before || before.resolvedAt) {
      return;
    }
    // Defensive: pausedAt should already be null by the time RESOLVED is
    // reachable (PENDING_* must return to IN_PROGRESS first), but clear it
    // rather than leave a dangling pause window on a closed clock.
    const after = await tx.slaInstance.update({
      where: { id: before.id },
      data: { resolvedAt, pausedAt: null },
    });
    await this.auditService.record(
      {
        actorId: actor.actorId,
        entityType: "SlaInstance",
        entityId: before.id,
        action: "RESOLVE",
        before,
        after,
        correlationId: actor.correlationId,
      },
      tx,
    );
  }

  /**
   * Called when transitioning IN_PROGRESS -> PENDING_VENDOR/PENDING_CUSTOMER.
   * No-ops if the resolved policy doesn't pause for that state (spec §10.8:
   * "SLA pause depends on policy").
   */
  async onPaused(
    tx: Prisma.TransactionClient,
    incidentId: string,
    toStatus: "PENDING_VENDOR" | "PENDING_CUSTOMER",
    actor: ActorContext,
  ): Promise<void> {
    const before = await this.findInstance(tx, incidentId);
    if (!before || before.resolvedAt || before.pausedAt) {
      return;
    }
    const policy = await tx.slaPolicy.findUnique({ where: { id: before.slaPolicyId } });
    const shouldPause =
      toStatus === "PENDING_VENDOR" ? policy?.pausesOnPendingVendor : policy?.pausesOnPendingCustomer;
    if (!shouldPause) {
      return;
    }
    const after = await tx.slaInstance.update({
      where: { id: before.id },
      data: { pausedAt: new Date() },
    });
    await this.auditService.record(
      {
        actorId: actor.actorId,
        entityType: "SlaInstance",
        entityId: before.id,
        action: "PAUSE",
        before,
        after,
        correlationId: actor.correlationId,
      },
      tx,
    );
  }

  /**
   * Called when transitioning PENDING_VENDOR/PENDING_CUSTOMER -> IN_PROGRESS.
   * Shifts `resolveDueAt` forward by the elapsed pause duration (a flat
   * wall-clock offset — spec: "resume timer if previously paused"), not a
   * calendar re-walk. No-ops if the clock wasn't actually paused (the
   * policy may not pause on that state at all).
   */
  async onResumed(
    tx: Prisma.TransactionClient,
    incidentId: string,
    actor: ActorContext,
  ): Promise<void> {
    const before = await this.findInstance(tx, incidentId);
    if (!before || !before.pausedAt) {
      return;
    }
    const pausedMs = Date.now() - before.pausedAt.getTime();
    const additionalPausedMinutes = Math.max(0, Math.round(pausedMs / 60_000));
    const newResolveDueAt = before.resolveDueAt
      ? new Date(before.resolveDueAt.getTime() + additionalPausedMinutes * 60_000)
      : before.resolveDueAt;

    const after = await tx.slaInstance.update({
      where: { id: before.id },
      data: {
        pausedAt: null,
        pausedMinutes: before.pausedMinutes + additionalPausedMinutes,
        resolveDueAt: newResolveDueAt,
      },
    });
    await this.auditService.record(
      {
        actorId: actor.actorId,
        entityType: "SlaInstance",
        entityId: before.id,
        action: "RESUME",
        before,
        after,
        correlationId: actor.correlationId,
      },
      tx,
    );
  }

  /**
   * Called from `IncidentsService.update()` when `dto.priority` changes.
   * Re-resolves the policy for the new priority and recomputes whichever
   * due date(s) haven't stopped yet, from *now* with the new policy's full
   * target minutes (Sprint 6 plan, Decision 6) — pause state is untouched.
   */
  async onPriorityChanged(
    tx: Prisma.TransactionClient,
    incident: IncidentSlaContext,
    newPriority: Priority,
    actor: ActorContext,
  ): Promise<void> {
    const before = await this.findInstance(tx, incident.id);
    if (!before) {
      return;
    }

    const now = new Date();
    const policy = await this.resolvePolicy(newPriority, now);
    const dueDates = await this.computeDueDates(incident.siteId, policy, now);

    const data: Prisma.SlaInstanceUncheckedUpdateInput = { slaPolicyId: policy.id };
    if (!before.ackedAt) {
      data.ackDueAt = dueDates.ackDueAt;
    }
    if (!before.resolvedAt) {
      data.resolveDueAt = dueDates.resolveDueAt;
    }

    const after = await tx.slaInstance.update({ where: { id: before.id }, data });
    await this.auditService.record(
      {
        actorId: actor.actorId,
        entityType: "SlaInstance",
        entityId: before.id,
        action: "PRIORITY_RECOMPUTE",
        before,
        after,
        correlationId: actor.correlationId,
      },
      tx,
    );
  }

  /**
   * Called when a transition sets `toStatus === "REOPENED"`. Resumes the
   * resolve clock (Sprint 6 plan, Decision 7) — the ack clock is left
   * alone, satisfied by the original acknowledgement.
   */
  async onReopened(
    tx: Prisma.TransactionClient,
    incidentId: string,
    actor: ActorContext,
  ): Promise<void> {
    const before = await this.findInstance(tx, incidentId);
    if (!before || !before.resolvedAt) {
      return;
    }
    const after = await tx.slaInstance.update({
      where: { id: before.id },
      data: { resolvedAt: null },
    });
    await this.auditService.record(
      {
        actorId: actor.actorId,
        entityType: "SlaInstance",
        entityId: before.id,
        action: "REOPEN",
        before,
        after,
        correlationId: actor.correlationId,
      },
      tx,
    );
  }

  /** Powers `GET /incidents/:id/sla` (Sprint 6 step 5). */
  async findForIncident(incidentId: string): Promise<SlaInstance | null> {
    return this.prisma.slaInstance.findFirst({ where: { incidentId } });
  }
}
