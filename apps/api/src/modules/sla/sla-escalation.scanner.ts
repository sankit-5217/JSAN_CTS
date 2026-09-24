import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import {
  InAppNotificationKind,
  Prisma,
  SlaInstance,
  SlaPolicy,
  Incident,
  User,
  Site,
  SiteContact,
  SupportGroup,
  SupportGroupMember,
} from "@prisma/client";
import type { EntityRef, NotificationEvent, Party } from "@cts-dc-opsdesk/email-adapter";
import { PrismaService } from "../../common/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { InboxService } from "../inbox/inbox.service";
import { SlaTimersPublisher } from "./sla-timers.publisher";

type SlaKindInternal = "ACK" | "RESOLVE";

type InstanceWithContext = SlaInstance & {
  slaPolicy: SlaPolicy;
  incident: Incident & {
    owner: User | null;
    site: Site & { contacts: SiteContact[] };
    ownerGroup: (SupportGroup & { members: (SupportGroupMember & { user: User })[] }) | null;
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
    private readonly inbox: InboxService,
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
        incident: {
          include: {
            owner: true,
            site: { include: { contacts: true } },
            ownerGroup: { include: { members: { include: { user: true } } } },
          },
        },
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

  /**
   * Owner + on-call site contacts (unchanged) plus, new: every active member
   * of the incident's assigned support group, when one is set. Previously an
   * unassigned-to-an-individual ticket (group-only, or no owner and no
   * on-call contact configured) got its SLA warning/breach silently dropped
   * — `notify()`'s `to.length === 0` guard just logged a warning and skipped
   * delivery entirely, so a breaching ticket with only a team assigned paged
   * no one. The team is now always included alongside the individual owner,
   * not just as a fallback when there's no owner — a breach is exactly the
   * moment backup coverage matters most.
   */
  private recipients(instance: InstanceWithContext): Party[] {
    const parties: Party[] = [];
    if (instance.incident.owner?.email) {
      parties.push({
        name: instance.incident.owner.displayName,
        email: instance.incident.owner.email,
      });
    }
    for (const contact of instance.incident.site.contacts) {
      if (contact.isOnCall && contact.email) {
        parties.push({ name: contact.name, email: contact.email });
      }
    }
    for (const member of instance.incident.ownerGroup?.members ?? []) {
      if (member.user.isActive && member.user.email) {
        parties.push({ name: member.user.displayName, email: member.user.email });
      }
    }
    // De-dupe by email — someone who's owner, on-call, and a group member
    // at once shouldn't get the same notification three times.
    const seen = new Set<string>();
    return parties.filter((p) => (seen.has(p.email) ? false : (seen.add(p.email), true)));
  }

  /**
   * The same audience as recipients(), but as user ids for the in-app bell.
   * Owner and group members are users already. An on-call site contact is
   * only a name and email, so they're included only if that email belongs
   * to an active user; otherwise they get the email alone.
   */
  private async recipientUserIds(instance: InstanceWithContext): Promise<string[]> {
    const ids: string[] = [];
    if (instance.incident.owner) {
      ids.push(instance.incident.owner.id);
    }
    for (const member of instance.incident.ownerGroup?.members ?? []) {
      ids.push(member.user.id);
    }
    const contactEmails = instance.incident.site.contacts
      .filter((c) => c.isOnCall && c.email)
      .map((c) => c.email as string);
    if (contactEmails.length > 0) {
      const contactUsers = await this.prisma.user.findMany({
        where: { email: { in: contactEmails } },
        select: { id: true },
      });
      ids.push(...contactUsers.map((u) => u.id));
    }
    return ids;
  }

  private async notifyInApp(
    instance: InstanceWithContext,
    crossed: CrossedMilestone,
  ): Promise<void> {
    try {
      const breached = crossed.percent === 100;
      const kindLabel = crossed.slaKind === "ACK" ? "Response" : "Resolution";
      await this.inbox.notifyUsers({
        userIds: await this.recipientUserIds(instance),
        kind: breached ? InAppNotificationKind.SLA_BREACHED : InAppNotificationKind.SLA_WARNING,
        title: breached
          ? `${kindLabel} SLA breached on ${instance.incident.incidentNo}`
          : `${kindLabel} SLA ${crossed.percent}% used on ${instance.incident.incidentNo}`,
        body: instance.incident.shortDescription,
        entityType: "INCIDENT",
        entityId: instance.incident.id,
        dedupeKey: `sla:${instance.id}:${crossed.milestone}`,
      });
    } catch (err) {
      this.logger.warn(
        `in-app SLA ${crossed.milestone} notification skipped for incident ${instance.incident.incidentNo}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  private async notify(instance: InstanceWithContext, crossed: CrossedMilestone): Promise<void> {
    await this.notifyInApp(instance, crossed);
    const to = this.recipients(instance);
    if (to.length === 0) {
      this.logger.warn(
        `SLA ${crossed.milestone} on incident ${instance.incident.incidentNo} has no owner, ` +
          `assigned-group member, or on-call contact to notify — skipping delivery`,
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
