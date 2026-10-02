import { Injectable } from "@nestjs/common";
import { IncidentStatus, Priority } from "@prisma/client";
import { PrismaService } from "../../common/prisma/prisma.service";
import { AuthenticatedUser } from "../auth/types/jwt-payload.type";
import { OPEN_STATUSES } from "../incidents/incident-transitions";
import { ShiftsService } from "../shifts/shifts.service";
import { deriveSlaStatus, SlaStatus } from "../sla/sla-status";

export type ClientSiteState = "NO_OPEN_ISSUES" | "ISSUE_IN_PROGRESS" | "MAJOR_INCIDENT";
export type DutyState = "ON_SHIFT" | "ON_CALL";

export interface ClientPortalContact {
  name: string;
  role: string;
  phone: string | null;
  email: string | null;
  isOnCall: boolean;
}

export interface ClientPortalTeamMember {
  name: string;
  duty: DutyState;
  shiftLabel: string;
  /** The caller's own open tickets this engineer is handling. */
  tickets: { id: string; incidentNo: string; shortDescription: string }[];
}

export interface ClientPortalSite {
  id: string;
  code: string;
  name: string;
  state: ClientSiteState;
  openIssues: number;
  contacts: ClientPortalContact[];
  team: ClientPortalTeamMember[];
}

export interface ClientPortalTicket {
  id: string;
  siteId: string;
  sla: SlaStatus | null;
  activity: {
    engineer: string | null;
    /** Null when nobody is assigned. */
    duty: DutyState | "OFF_DUTY" | null;
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
 * see, how to reach the service desk, who's on duty and whether anything is
 * open there; and for each of their own tickets, its SLA status and whether
 * someone is on it right now. Read-only, like the rest of this module.
 *
 * What a customer may see here is deliberately narrower than the staff
 * equivalents: engineer names and duty status but never their email (the
 * staff-only GET /shifts/live carries it), site-wide incidents only as a
 * count, and ticket detail only for tickets they reported themselves (same
 * rule as IncidentsService.findOneScoped).
 */
@Injectable()
export class ClientPortalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly shiftsService: ShiftsService,
  ) {}

  async getOverview(
    user: AuthenticatedUser,
    accessibleSiteIds: string[],
    now: Date = new Date(),
  ): Promise<ClientPortalOverview> {
    const [sites, openBySite, tickets, roster] = await Promise.all([
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
          ownerUserId: true,
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
      this.shiftsService.getLiveRoster({}, accessibleSiteIds, now),
    ]);

    // siteId -> userId -> duty. A working shift wins over an on-call window
    // when someone has both active at once.
    const dutyBySite = new Map<
      string,
      Map<string, { name: string; duty: DutyState; label: string }>
    >();
    for (const entry of [...roster.onCall, ...roster.working]) {
      const bySite = dutyBySite.get(entry.siteId) ?? new Map();
      bySite.set(entry.userId, {
        name: entry.displayName,
        duty: entry.isOnCall ? "ON_CALL" : "ON_SHIFT",
        label: entry.label,
      });
      dutyBySite.set(entry.siteId, bySite);
    }

    const isOpen = (status: IncidentStatus) => OPEN_STATUSES.includes(status);

    return {
      asOf: now.toISOString(),
      sites: sites.map((site) => {
        const counts = openBySite.filter((row) => row.siteId === site.id);
        const openIssues = counts.reduce((sum, row) => sum + row._count._all, 0);
        const major = counts.some((row) => MAJOR_PRIORITIES.includes(row.priority));
        const duty = dutyBySite.get(site.id) ?? new Map();
        return {
          id: site.id,
          code: site.code,
          name: site.name,
          state: major ? "MAJOR_INCIDENT" : openIssues > 0 ? "ISSUE_IN_PROGRESS" : "NO_OPEN_ISSUES",
          openIssues,
          contacts: site.contacts
            .filter((c) => c.phone || c.email)
            .sort((a, b) => Number(b.isOnCall) - Number(a.isOnCall)),
          team: [...duty.entries()]
            .map(([userId, member]) => ({
              name: member.name,
              duty: member.duty,
              shiftLabel: member.label,
              tickets: tickets
                .filter((t) => t.siteId === site.id && t.ownerUserId === userId && isOpen(t.status))
                .map((t) => ({
                  id: t.id,
                  incidentNo: t.incidentNo,
                  shortDescription: t.shortDescription,
                })),
            }))
            .sort((a, b) => a.name.localeCompare(b.name)),
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
            duty: t.ownerUserId
              ? (dutyBySite.get(t.siteId)?.get(t.ownerUserId)?.duty ?? "OFF_DUTY")
              : null,
            workingNow: session
              ? { engineer: session.engineer.displayName, since: session.startedAt }
              : null,
          },
        };
      }),
    };
  }
}
