import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { Prisma, SlaInstance, SlaPolicy, Incident, User, Site, SiteContact } from "@prisma/client";
import type { EntityRef, NotificationEvent, Party } from "@cts-dc-opsdesk/email-adapter";
import { PrismaService } from "../../common/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { SlaTimersPublisher } from "./sla-timers.publisher";

type SlaKindInternal = "ACK" | "RESOLVE";

type InstanceWithContext = SlaInstance & {
  slaPolicy: SlaPolicy;
  incident: Incident & {
    owner: User | null;
    site: Site & { contacts: SiteContact[] };
  };
};

interface CrossedMilestone {
  slaKind: SlaKindInternal;
  milestone: string;
  percent: number;
  dueAt: Date;
}

/**
 * Periodic in-process scan — the single source of truth for "which SLA
 * instances just crossed a threshold" (Sprint 6 plan, Decision 1). Writes
 * the audit/timeline evidence itself (never relies on the worker for that —
 * apps/worker has no DB access), then hands delivery off to
 * SlaTimersPublisher. Every minute is more than adequate precision for
 * 15-minute-to-5-day SLA targets.
 *
 * Threshold instants are a flat wall-clock offset before the due date
 * (`dueAt - targetMinutes * (1 - percent/100)`), not a calendar re-walk —
 * same simplification `onResumed`'s pause-shift already makes; an exact
 * calendar-aware threshold isn't worth the complexity for an escalation
 * warning.
 */
@Injectable()
export class SlaEscalationScanner {
  private readonly logger = new Logger(SlaEscalationScanner.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly publisher: SlaTimersPublisher,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async scan(): Promise<void> {
    const now = new Date();
    const openInstances = (await this.prisma.slaInstance.findMany({
      where: {
        OR: [
          { ackedAt: null, ackDueAt: { not: null } },
          { resolvedAt: null, pausedAt: null, resolveDueAt: { not: null } },
        ],
      },
      include: {
        slaPolicy: true,
        incident: { include: { owner: true, site: { include: { contacts: true } } } },
      },
    })) as InstanceWithContext[];

    for (const instance of openInstances) {
      try {
        await this.evaluateInstance(instance, now);
      } catch (err) {
        // One bad instance must not stop the rest of the scan from running.
        this.logger.error(
          `failed evaluating SLA instance ${instance.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  private findCrossedMilestones(
    slaKind: SlaKindInternal,
    dueAt: Date,
    targetMinutes: number,
    firedMilestones: string[],
    thresholdsPercent: number[],
    now: Date,
  ): CrossedMilestone[] {
    const candidates = [...new Set([...thresholdsPercent, 100])].sort((a, b) => a - b);
    const crossed: CrossedMilestone[] = [];
    for (const percent of candidates) {
      const milestone = `${slaKind}_${percent === 100 ? "BREACH" : percent}`;
      if (firedMilestones.includes(milestone)) {
        continue;
      }
      const thresholdAt = new Date(dueAt.getTime() - targetMinutes * 60_000 * (1 - percent / 100));
      if (now >= thresholdAt) {
        crossed.push({ slaKind, milestone, percent, dueAt });
      }
    }
    return crossed;
  }

  private async evaluateInstance(instance: InstanceWithContext, now: Date): Promise<void> {
    const crossed: CrossedMilestone[] = [];

    if (!instance.ackedAt && instance.ackDueAt) {
      crossed.push(
        ...this.findCrossedMilestones(
          "ACK",
          instance.ackDueAt,
          instance.slaPolicy.ackTargetMinutes,
          instance.firedMilestones,
          instance.slaPolicy.escalationThresholdsPercent,
          now,
        ),
      );
    }
    if (!instance.resolvedAt && !instance.pausedAt && instance.resolveDueAt) {
      crossed.push(
        ...this.findCrossedMilestones(
          "RESOLVE",
          instance.resolveDueAt,
          instance.slaPolicy.resolveTargetMinutes,
          instance.firedMilestones,
          instance.slaPolicy.escalationThresholdsPercent,
          now,
        ),
      );
    }

    if (crossed.length === 0) {
      return;
    }

    await this.prisma.$transaction(async (tx) => {
      for (const c of crossed) {
        const data: Prisma.SlaInstanceUpdateInput = { firedMilestones: { push: c.milestone } };
        if (c.percent === 100) {
          data.breached = true;
        }
        await tx.slaInstance.update({ where: { id: instance.id }, data });

        await tx.incidentEvent.create({
          data: {
            incidentId: instance.incidentId,
            eventType: "SLA_EVENT",
            actorId: null,
            payload: {
              slaKind: c.slaKind,
              milestone: c.milestone,
              dueAt: c.dueAt,
              policyId: instance.slaPolicyId,
            } as Prisma.InputJsonValue,
          },
        });

        await this.auditService.record(
          {
            actorId: null,
            entityType: "SlaInstance",
            entityId: instance.id,
            action: "SLA_EVENT",
            after: { milestone: c.milestone, slaKind: c.slaKind, dueAt: c.dueAt },
          },
          tx,
        );
      }
    });

    // Delivery is best-effort and happens after the evidence is durably
    // committed — never the other way around (Sprint 5's S3-before-tx
    // precedent, mirrored here in reverse: DB write first, unreliable I/O after).
    for (const c of crossed) {
      await this.notify(instance, c);
    }
  }

  private recipients(instance: InstanceWithContext): Party[] {
    const parties: Party[] = [];
    if (instance.incident.owner?.email) {
      parties.push({ name: instance.incident.owner.displayName, email: instance.incident.owner.email });
    }
    for (const contact of instance.incident.site.contacts) {
      if (contact.isOnCall && contact.email) {
        parties.push({ name: contact.name, email: contact.email });
      }
    }
    // De-dupe by email — an owner who's also listed as an on-call contact
    // shouldn't get the same notification twice.
    const seen = new Set<string>();
    return parties.filter((p) => (seen.has(p.email) ? false : (seen.add(p.email), true)));
  }

  private async notify(instance: InstanceWithContext, crossed: CrossedMilestone): Promise<void> {
    const to = this.recipients(instance);
    if (to.length === 0) {
      this.logger.warn(
        `SLA ${crossed.milestone} on incident ${instance.incident.incidentNo} has no owner or on-call contact to notify — skipping delivery`,
      );
      return;
    }

    const entity: EntityRef = {
      key: instance.incident.incidentNo,
      title: instance.incident.shortDescription,
      siteCode: instance.incident.site.code,
      priority: instance.incident.priority,
    };
    const slaKind = crossed.slaKind === "ACK" ? "RESPONSE" : "RESOLUTION";

    const event: NotificationEvent =
      crossed.percent === 100
        ? { kind: "SLA_BREACHED", entity, slaKind, breachedAt: crossed.dueAt.toISOString() }
        : {
            kind: "SLA_WARNING",
            entity,
            slaKind,
            dueAt: crossed.dueAt.toISOString(),
            minutesRemaining: Math.max(
              0,
              Math.round((crossed.dueAt.getTime() - Date.now()) / 60_000),
            ),
          };

    await this.publisher.enqueue(
      { event, recipients: { to } },
      `sla:${instance.id}:${crossed.milestone}`,
    );
  }
}
