import { Injectable } from "@nestjs/common";
import { AlertSeverity, AlertState, CiType, IncidentStatus, Priority } from "@prisma/client";
import { PrismaService } from "../../common/prisma/prisma.service";
import { OPEN_STATUSES } from "../incidents/incident-transitions";

export type HealthLevel = "HEALTHY" | "WARNING" | "CRITICAL" | "UNKNOWN";

const HEALTH_RANK: Record<HealthLevel, number> = {
  HEALTHY: 0,
  UNKNOWN: 1,
  WARNING: 2,
  CRITICAL: 3,
};

/** MAINTENANCE and anything unrecognized roll up as UNKNOWN — spec §10.1:
 * "never infer healthy only because no ticket exists" applies just as much
 * to missing/ambiguous health data. */
function normalizeHealth(overallHealth: string | undefined): HealthLevel {
  if (overallHealth === "CRITICAL" || overallHealth === "WARNING" || overallHealth === "HEALTHY") {
    return overallHealth;
  }
  return "UNKNOWN";
}

/** Worst-of-its-CIs rollup (Sprint 7 plan, Decision 2) — a deterministic v1
 * default, not the fully configurable rule engine spec's prose gestures at.
 * No CIs at all is UNKNOWN (spec §10.1: never infer healthy from absent
 * data); otherwise the fold starts optimistic at HEALTHY (rank 0) so a
 * single all-HEALTHY CI correctly stays HEALTHY — seeding it at UNKNOWN
 * would make a lone HEALTHY CI (a *lower* rank) never numerically exceed
 * the seed and the result would never leave UNKNOWN. */
function worstOf(levels: HealthLevel[]): HealthLevel {
  if (levels.length === 0) {
    return "UNKNOWN";
  }
  return levels.reduce<HealthLevel>(
    (worst, level) => (HEALTH_RANK[level] > HEALTH_RANK[worst] ? level : worst),
    "HEALTHY",
  );
}

export interface SiteCard {
  id: string;
  code: string;
  name: string;
  health: HealthLevel;
  serversReachable: number;
  serversTotal: number;
  openIncidents: number;
  oldestOpenIncidentAgeMinutes: number | null;
}

export interface CommandCenterSummary {
  counters: {
    sitesHealthy: number;
    sitesWarning: number;
    sitesCritical: number;
    serversReachable: number;
    serversTotal: number;
    criticalAlertsOpen: number;
    p1p2OpenIncidents: number;
    slaAtRiskIncidents: number;
  };
  siteCards: SiteCard[];
  queues: {
    unassigned: number;
    awaitingAck: number;
    slaBreachRisk: number;
    vendorWaiting: number;
    reopened: number;
  };
}

interface IncidentRow {
  siteId: string;
  status: IncidentStatus;
  priority: Priority;
  createdAt: Date;
  slaInstances: { breached: boolean; firedMilestones: string[] }[];
}

/**
 * Owns: read models/aggregations for the Command Center (spec §10.1, §12).
 * Must not own source-of-truth mutations.
 *
 * Reads CMDB/incidents/sla/alerts tables directly rather than through their
 * owning services (Sprint 7 plan, Decision 1) — a read-model module doing
 * exactly what its name says, not duplicating or mutating another module's
 * business logic.
 */
@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  /** An open SlaInstance with a warning threshold fired but not yet breached
   * (Sprint 7 plan, Decision 6) — reuses Sprint 6's own escalation tracking. */
  private isSlaAtRisk(instance: { breached: boolean; firedMilestones: string[] }): boolean {
    return !instance.breached && instance.firedMilestones.length > 0;
  }

  async getCommandCenterSummary(accessibleSiteIds: string[] | null): Promise<CommandCenterSummary> {
    const sites = await this.prisma.site.findMany({
      where: accessibleSiteIds ? { id: { in: accessibleSiteIds } } : undefined,
      select: { id: true, code: true, name: true },
      orderBy: { code: "asc" },
    });
    const siteIds = sites.map((s) => s.id);

    const cis = await this.prisma.configurationItem.findMany({
      where: { siteId: { in: siteIds } },
      select: { siteId: true, ciType: true, healthSnapshot: { select: { overallHealth: true } } },
    });

    const incidents: IncidentRow[] = await this.prisma.incident.findMany({
      where: { siteId: { in: siteIds } },
      select: {
        siteId: true,
        status: true,
        priority: true,
        createdAt: true,
        slaInstances: { select: { breached: true, firedMilestones: true } },
      },
    });

    const criticalAlertsOpen = await this.prisma.alert.count({
      where: { siteId: { in: siteIds }, severity: AlertSeverity.CRITICAL, state: AlertState.OPEN },
    });

    const now = Date.now();
    let sitesHealthy = 0;
    let sitesWarning = 0;
    let sitesCritical = 0;
    let serversReachable = 0;
    let serversTotal = 0;

    const siteCards: SiteCard[] = sites.map((site) => {
      const siteCis = cis.filter((ci) => ci.siteId === site.id);
      const health = worstOf(siteCis.map((ci) => normalizeHealth(ci.healthSnapshot?.overallHealth)));
      if (health === "CRITICAL") {
        sitesCritical += 1;
      } else if (health === "WARNING") {
        sitesWarning += 1;
      } else if (health === "HEALTHY") {
        sitesHealthy += 1;
      }
      // UNKNOWN sites count toward none of the three headline buckets.

      const siteServers = siteCis.filter((ci) => ci.ciType === CiType.SERVER);
      const siteServersReachable = siteServers.filter((ci) => {
        const level = normalizeHealth(ci.healthSnapshot?.overallHealth);
        return level !== "CRITICAL" && level !== "UNKNOWN";
      }).length;
      serversTotal += siteServers.length;
      serversReachable += siteServersReachable;

      const openSiteIncidents = incidents.filter(
        (i) => i.siteId === site.id && OPEN_STATUSES.includes(i.status),
      );
      const oldestOpen = openSiteIncidents.reduce<Date | null>(
        (oldest, i) => (!oldest || i.createdAt < oldest ? i.createdAt : oldest),
        null,
      );

      return {
        id: site.id,
        code: site.code,
        name: site.name,
        health,
        serversReachable: siteServersReachable,
        serversTotal: siteServers.length,
        openIncidents: openSiteIncidents.length,
        oldestOpenIncidentAgeMinutes: oldestOpen
          ? Math.round((now - oldestOpen.getTime()) / 60_000)
          : null,
      };
    });

    const openIncidents = incidents.filter((i) => OPEN_STATUSES.includes(i.status));
    const p1p2OpenIncidents = openIncidents.filter(
      (i) => i.priority === Priority.P1 || i.priority === Priority.P2,
    ).length;
    const slaAtRiskIncidents = openIncidents.filter((i) =>
      i.slaInstances.some((inst) => this.isSlaAtRisk(inst)),
    ).length;

    return {
      counters: {
        sitesHealthy,
        sitesWarning,
        sitesCritical,
        serversReachable,
        serversTotal,
        criticalAlertsOpen,
        p1p2OpenIncidents,
        slaAtRiskIncidents,
      },
      siteCards,
      queues: {
        unassigned: openIncidents.filter((i) => i.status === IncidentStatus.NEW).length,
        awaitingAck: openIncidents.filter((i) => i.status === IncidentStatus.ASSIGNED).length,
        slaBreachRisk: slaAtRiskIncidents,
        vendorWaiting: openIncidents.filter((i) => i.status === IncidentStatus.PENDING_VENDOR).length,
        reopened: openIncidents.filter((i) => i.status === IncidentStatus.REOPENED).length,
      },
    };
  }
}
