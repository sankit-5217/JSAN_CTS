import { Injectable } from "@nestjs/common";
import { IncidentStatus } from "@prisma/client";
import { PrismaService } from "../../common/prisma/prisma.service";
import { AuthenticatedUser } from "../auth/types/jwt-payload.type";
import { OPEN_STATUSES } from "../incidents/incident-transitions";
import { deriveSlaStatus } from "../sla/sla-status";

export interface ClientPerformanceTotals {
  reported: number;
  /** Still live: with the desk, or waiting on the customer's confirmation. */
  open: number;
  /** A fix was delivered (RESOLVED or CLOSED). */
  resolved: number;
  /** Finished and closed. */
  closed: number;
}

export interface ClientPerformanceSla {
  /** Resolution target met. */
  met: number;
  /** Resolution target missed. */
  breached: number;
  /** Still inside the resolution target. */
  onTrack: number;
  /** Inside the target but close to it. */
  atRisk: number;
  /** Clock paused (waiting on the customer or a vendor). */
  paused: number;
}

export interface ClientPerformanceMonthly {
  /** "2026-01" */
  month: string;
  reported: number;
  resolved: number;
}

export interface ClientPerformanceReport {
  windowDays: number;
  from: string;
  to: string;
  totals: ClientPerformanceTotals;
  sla: ClientPerformanceSla;
  /** Average minutes to acknowledge and to resolve, over resolved tickets. */
  averages: {
    ackMinutes: number | null;
    resolveMinutes: number | null;
  };
  monthly: ClientPerformanceMonthly[];
}

/** Statuses where the desk has handed the ticket back to the customer. */
const FINISHED_STATUSES: readonly IncidentStatus[] = [
  IncidentStatus.RESOLVED,
  IncidentStatus.CLOSED,
];

/** Statuses that will never progress again — neither open nor resolved. */
const DEAD_STATUSES: readonly IncidentStatus[] = [
  IncidentStatus.CANCELLED,
  IncidentStatus.DUPLICATE,
];

/** How many months of trend to show — a year of history. */
const MONTHS_IN_TREND = 12;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Owns: the client portal's own performance read model — how the tickets
 * *this customer* raised have been handled. Read-only, like the rest of
 * this module.
 *
 * Scope is the caller's own reports (`reportedByUserId`), the same set the
 * client portal already shows them — this adds an aggregate over those
 * tickets, never a wider view. The SLA verdict comes from the stored
 * SlaInstance via deriveSlaStatus, so a ticket's numbers here are the same
 * ones its badge shows on the ticket page.
 */
@Injectable()
export class ClientPerformanceService {
  constructor(private readonly prisma: PrismaService) {}

  async getReport(
    user: AuthenticatedUser,
    accessibleSiteIds: string[],
    now: Date = new Date(),
  ): Promise<ClientPerformanceReport> {
    // The window starts at the beginning of the oldest month in the trend,
    // so the totals and the monthly buckets always describe the same span.
    const trendStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (MONTHS_IN_TREND - 1), 1),
    );
    const from = trendStart;

    const incidents = await this.prisma.incident.findMany({
      where: {
        siteId: { in: accessibleSiteIds },
        reportedByUserId: user.id,
        createdAt: { gte: from, lte: now },
      },
      select: {
        id: true,
        status: true,
        createdAt: true,
        acknowledgedAt: true,
        restoredAt: true,
        slaInstances: {
          select: {
            ackDueAt: true,
            ackedAt: true,
            resolveDueAt: true,
            resolvedAt: true,
            pausedAt: true,
            firedMilestones: true,
          },
          take: 1,
        },
      },
    });

    const totals: ClientPerformanceTotals = {
      reported: incidents.length,
      open: 0,
      resolved: 0,
      closed: 0,
    };
    const sla: ClientPerformanceSla = {
      met: 0,
      breached: 0,
      onTrack: 0,
      atRisk: 0,
      paused: 0,
    };
    const ackMinutes: number[] = [];
    const resolveMinutes: number[] = [];
    const byMonth = new Map<string, ClientPerformanceMonthly>();

    for (const incident of incidents) {
      const isDead = DEAD_STATUSES.includes(incident.status);
      const isFinished = FINISHED_STATUSES.includes(incident.status);

      if (isFinished) {
        totals.resolved += 1;
        if (incident.status === IncidentStatus.CLOSED) totals.closed += 1;
        if (incident.acknowledgedAt) {
          ackMinutes.push(
            ClientPerformanceService.minutesBetween(incident.createdAt, incident.acknowledgedAt),
          );
        }
        if (incident.restoredAt) {
          resolveMinutes.push(
            ClientPerformanceService.minutesBetween(incident.createdAt, incident.restoredAt),
          );
        }
      } else if (!isDead) {
        // The same open/closed split the platform uses everywhere else
        // (OPEN_STATUSES), so this agrees with the client's ticket list.
        if (OPEN_STATUSES.includes(incident.status)) totals.open += 1;
      }

      // The resolution clock is the one the customer waits on. A finished
      // ticket's clock has completed (MET unless it was late); a live
      // ticket's is still running (on track, at risk, breached or paused).
      const instance = incident.slaInstances[0];
      if (instance) {
        const resolution = deriveSlaStatus(instance, now).resolution;
        if (resolution.completedAt) {
          if (resolution.state === "MET") sla.met += 1;
          else sla.breached += 1;
        } else if (resolution.state === "PAUSED") sla.paused += 1;
        else if (resolution.state === "AT_RISK") sla.atRisk += 1;
        else if (resolution.state === "BREACHED") sla.breached += 1;
        else sla.onTrack += 1;
      }

      const month = ClientPerformanceService.monthKey(incident.createdAt);
      const bucket = byMonth.get(month) ?? { month, reported: 0, resolved: 0 };
      bucket.reported += 1;
      if (isFinished) bucket.resolved += 1;
      byMonth.set(month, bucket);
    }

    return {
      windowDays: Math.round((now.getTime() - from.getTime()) / DAY_MS),
      from: from.toISOString(),
      to: now.toISOString(),
      totals,
      sla,
      averages: {
        ackMinutes: ClientPerformanceService.average(ackMinutes),
        resolveMinutes: ClientPerformanceService.average(resolveMinutes),
      },
      monthly: ClientPerformanceService.monthlyTrend(byMonth, now),
    };
  }

  /** Months in the trend, oldest first, with empty months filled in. */
  private static monthlyTrend(
    byMonth: Map<string, ClientPerformanceMonthly>,
    now: Date,
  ): ClientPerformanceMonthly[] {
    const out: ClientPerformanceMonthly[] = [];
    for (let back = MONTHS_IN_TREND - 1; back >= 0; back -= 1) {
      const cursor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
      const month = cursor.toISOString().slice(0, 7);
      out.push(byMonth.get(month) ?? { month, reported: 0, resolved: 0 });
    }
    return out;
  }

  private static monthKey(date: Date): string {
    return date.toISOString().slice(0, 7);
  }

  private static minutesBetween(start: Date, end: Date): number {
    return Math.max(0, Math.round((end.getTime() - start.getTime()) / 60_000));
  }

  private static average(values: number[]): number | null {
    if (values.length === 0) return null;
    return Math.round(values.reduce((sum, v) => sum + v, 0) / values.length);
  }
}
