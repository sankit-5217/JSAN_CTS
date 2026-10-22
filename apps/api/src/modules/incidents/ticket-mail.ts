import { IncidentStatus, IssueCatalogKind, Prisma, UserRole } from "@prisma/client";
import type { EntityRef, Party } from "@cts-dc-opsdesk/email-adapter";
import { TEMPLATE_STATUS_FOR, TEMPLATE_STATUS_LABEL } from "./incident-status-display";

/**
 * Who every ticket email goes to, and what it shows (user's rules,
 * 2026-10-22):
 *   - Subject `INC-00002[Bug][P3,S3] Uploads are slow` on every email about
 *     a ticket, so they all thread together.
 *   - To: the assignee and every member of the assignee group. Nobody
 *     assigned yet → the service desk, so a mail never goes nowhere.
 *   - Cc: the reporter and the ticket's CC list, in the Cc header, so
 *     everyone on the mail sees everyone else. Never on an internal note.
 *   - The body opens with who made the change, their role and when.
 *
 * Plain functions over a Prisma reader so the SLA scanner (which the
 * incidents module depends on, not the other way round) can use them too.
 */

type Reader = Pick<
  Prisma.TransactionClient,
  "user" | "supportGroup" | "supportGroupMember" | "issueCatalogOption"
>;

export type TicketMailIncident = {
  incidentNo: string;
  shortDescription: string;
  priority: string;
  severity: string | null;
  issueType: string | null;
  status: IncidentStatus;
  ownerUserId: string | null;
  ownerGroupId: string | null;
  reportedByUserId: string | null;
  ccEmails: string[];
};

/** The role as the people on the mail know it (matches the portal's labels). */
const ROLE_LABEL: Partial<Record<UserRole, string>> = {
  CLIENT_MANAGER_VIEWER: "Client",
  SERVICE_DESK_NOC: "Service desk",
  SITE_ENGINEER: "Engineer",
  INFRASTRUCTURE_LEAD: "Infrastructure lead",
  DELIVERY_OPS_MANAGER: "Delivery manager",
  SUPER_ADMIN: "JSAN team",
};

export function ticketStatusLabel(status: IncidentStatus): string {
  const shown = TEMPLATE_STATUS_FOR[status];
  return shown ? TEMPLATE_STATUS_LABEL[shown] : "Cancelled";
}

/**
 * The ticket as an email shows it: labels, not codes. `by` names who made
 * this change (omitted for system mails such as SLA timers); a system
 * actor such as skill-based routing passes its own name.
 */
export async function ticketEntityRef(
  db: Reader,
  incident: TicketMailIncident,
  by?: { userId?: string | null; name?: string; at?: Date },
): Promise<EntityRef> {
  const [issueType, owner, group, actor] = await Promise.all([
    incident.issueType
      ? db.issueCatalogOption.findUnique({
          where: {
            kind_value: { kind: IssueCatalogKind.ISSUE_TYPE, value: incident.issueType },
          },
          select: { label: true },
        })
      : null,
    incident.ownerUserId
      ? db.user.findUnique({
          where: { id: incident.ownerUserId },
          select: { displayName: true },
        })
      : null,
    incident.ownerGroupId
      ? db.supportGroup.findUnique({
          where: { id: incident.ownerGroupId },
          select: { name: true },
        })
      : null,
    by?.userId
      ? db.user.findUnique({
          where: { id: by.userId },
          select: { displayName: true, email: true, role: true },
        })
      : null,
  ]);
  const actorName = actor ? actor.displayName || actor.email : by?.name;
  return {
    key: incident.incidentNo,
    title: incident.shortDescription,
    priority: incident.priority,
    severity: incident.severity ?? undefined,
    ticket: {
      // A retired or unknown code still shows as itself, never blank.
      issueType: issueType?.label ?? incident.issueType ?? undefined,
      status: ticketStatusLabel(incident.status),
      assignee: owner?.displayName,
      assigneeGroup: group?.name,
      updatedBy: actorName
        ? {
            name: actorName,
            role: actor?.role ? ROLE_LABEL[actor.role] : undefined,
            at: (by?.at ?? new Date()).toISOString(),
          }
        : undefined,
    },
  };
}

/**
 * To: assignee + assignee-group members (else the service desk). Cc: the
 * reporter and the CC list, unless `internal`. Each address appears once,
 * in To before Cc. Null when there is no one at all to write to.
 */
export async function ticketRecipients(
  db: Reader,
  incident: TicketMailIncident,
  opts: { internal?: boolean } = {},
): Promise<{ to: Party[]; cc?: Party[] } | null> {
  const seen = new Set<string>();
  const take = (parties: Party[]): Party[] =>
    parties.filter((p) => {
      const key = p.email.trim().toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  const person = (u: { displayName: string; email: string }): Party => ({
    name: u.displayName || undefined,
    email: u.email,
  });

  const handlers: Party[] = [];
  if (incident.ownerUserId) {
    const owner = await db.user.findUnique({ where: { id: incident.ownerUserId } });
    if (owner && owner.isActive !== false && owner.email) handlers.push(person(owner));
  }
  if (incident.ownerGroupId) {
    const members = await db.supportGroupMember.findMany({
      where: { groupId: incident.ownerGroupId, user: { isActive: true } },
      include: { user: true },
    });
    handlers.push(...members.filter((m) => m.user.email).map((m) => person(m.user)));
  }
  if (handlers.length === 0) {
    const desk = await db.user.findMany({
      where: { isActive: true, role: UserRole.SERVICE_DESK_NOC },
    });
    handlers.push(...desk.filter((u) => u.email).map(person));
  }
  let to = take(handlers);

  let cc: Party[] = [];
  if (!opts.internal) {
    const reporter = incident.reportedByUserId
      ? await db.user.findUnique({ where: { id: incident.reportedByUserId } })
      : null;
    cc = take([
      ...(reporter && reporter.isActive !== false && reporter.email ? [person(reporter)] : []),
      ...(incident.ccEmails ?? []).map((email) => ({ email })),
    ]);
  }
  if (to.length === 0) {
    // No staff to address (no assignee, empty group, no service desk):
    // the people on Cc still hear about it.
    to = cc;
    cc = [];
  }
  if (to.length === 0) return null;
  return cc.length > 0 ? { to, cc } : { to };
}
