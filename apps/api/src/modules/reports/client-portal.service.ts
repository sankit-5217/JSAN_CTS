import { Injectable } from "@nestjs/common";
import { IncidentStatus, Priority } from "@prisma/client";
import { PrismaService } from "../../common/prisma/prisma.service";
import { AuthenticatedUser } from "../auth/types/jwt-payload.type";
import { OPEN_STATUSES } from "../incidents/incident-transitions";
import { deriveSlaStatus, SlaStatus } from "../sla/sla-status";

export type ClientSiteState = "NO_OPEN_ISSUES" | "ISSUE_IN_PROGRESS" | "MAJOR_INCIDENT";

export interface ClientPortalContact {
  name: string;
  role: string;
  phone: string | null;
  email: string | null;
  isOnCall: boolean;
}

export interface ClientPortalSite {
  id: string;
  code: string;
  name: string;
  state: ClientSiteState;
  openIssues: number;
  contacts: ClientPortalContact[];
}

export interface ClientPortalTicket {
  id: string;
  siteId: string;
  sla: SlaStatus | null;
  activity: {
    engineer: string | null;
    /** Someone has a work session open on the ticket right now. */
    workingNow: { engineer: string; since: Date } | null;
  };
}

export interface ClientPortalOverview {
  asOf: string;
  sites: ClientPortalSite[];
  tickets: ClientPortalTicket[];
}

const MAJOR_PRIORITIES: readonly Priority[] = [Priority.P1, Priority.P2];

// Matches the client portal's own ticket list page size.
const TICKET_LIMIT = 200;

/**
 * Owns: the client portal's read model — for each site the customer can
 * see, how to reach the service desk and whether anything is
 * open there; and for each of their own tickets, its SLA status and whether
 * someone is on it right now. Read-only, like the rest of this module.
 *
 * What a customer may see here is deliberately narrower than the staff
 * equivalents: the assigned engineer's name but nothing about shifts or
 * who is on duty (switched off for clients on 2026-10-13; the staff-only
 * GET /shifts/live has the roster), site-wide incidents only as a count,
 * and ticket detail only for tickets they reported themselves (same rule
 * as IncidentsService.findOneScoped).
 */
@Injectable()
export class ClientPortalService {
  constructor(private readonly prisma: PrismaService) {}

  async getOverview(
    user: AuthenticatedUser,
    accessibleSiteIds: string[],
    now: Date = new Date(),
  ): Promise<ClientPortalOverview> {
    const [sites, openBySite, tickets] = await Promise.all([
      this.prisma.site.findMany({
        where: { id: { in: accessibleSiteIds } },
        select: {
          id: true,
          code: true,
          name: true,
          contacts: {
            select: { name: true, role: true, phone: true, email: true, isOnCall: true },
            orderBy: { name: "asc" },
          },
        },
        orderBy: { code: "asc" },
      }),
      this.prisma.incident.groupBy({
        by: ["siteId", "priority"],
        where: { siteId: { in: accessibleSiteIds }, status: { in: OPEN_STATUSES } },
        _count: { _all: true },
      }),
      this.prisma.incident.findMany({
        where: { siteId: { in: accessibleSiteIds }, reportedByUserId: user.id },
        select: {
          id: true,
          incidentNo: true,
          shortDescription: true,
          siteId: true,
          status: true,
          owner: { select: { displayName: true } },
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
          worklogs: {
            where: { endedAt: null },
            select: { startedAt: true, engineer: { select: { displayName: true } } },
            orderBy: { startedAt: "desc" },
            take: 1,
          },
        },
        orderBy: { createdAt: "desc" },
        take: TICKET_LIMIT,
      }),
    ]);

    const isOpen = (status: IncidentStatus) => OPEN_STATUSES.includes(status);

    return {
      asOf: now.toISOString(),
      sites: sites.map((site) => {
        const counts = openBySite.filter((row) => row.siteId === site.id);
        const openIssues = counts.reduce((sum, row) => sum + row._count._all, 0);
        const major = counts.some((row) => MAJOR_PRIORITIES.includes(row.priority));
        return {
          id: site.id,
          code: site.code,
          name: site.name,
          state: major ? "MAJOR_INCIDENT" : openIssues > 0 ? "ISSUE_IN_PROGRESS" : "NO_OPEN_ISSUES",
          openIssues,
          contacts: site.contacts
            .filter((c) => c.phone || c.email)
            .sort((a, b) => Number(b.isOnCall) - Number(a.isOnCall)),
        };
      }),
      tickets: tickets.map((t) => {
        const session = isOpen(t.status) ? t.worklogs[0] : undefined;
        return {
          id: t.id,
          siteId: t.siteId,
          sla: t.slaInstances[0] ? deriveSlaStatus(t.slaInstances[0], now) : null,
          activity: {
            engineer: t.owner?.displayName ?? null,
            workingNow: session
              ? { engineer: session.engineer.displayName, since: session.startedAt }
              : null,
          },
        };
      }),
    };
  }
}
