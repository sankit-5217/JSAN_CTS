import { IncidentStatus } from "@prisma/client";
import { TRANSITION_RULES, TransitionDto, TransitionRule } from "./incident-transitions";

/**
 * The issue template's Status list (client portal, ticket page, staff
 * incident page). It is a view over the spec §15 state machine, not a
 * second one: every label maps onto one or more IncidentStatus values, and
 * picking a label runs the shortest chain of ordinary transitions that
 * lands on it — each step still checked by the rule table (role, owner,
 * required fields), audited and fed to the SLA hooks.
 *
 * Mirrored for display in apps/web/src/pages/client/issueStatus.ts.
 */
export const TEMPLATE_STATUSES = [
  "NEW",
  "ASSIGNED",
  "IN_PROGRESS",
  "PENDING_3RD_PARTY",
  "ASSIGNED_TO_REQUESTER",
  "FIXED",
  "BLOCKED_BY",
  "DUPLICATE_OF",
] as const;
export type TemplateStatus = (typeof TEMPLATE_STATUSES)[number];

export const TEMPLATE_STATUS_LABEL: Record<TemplateStatus, string> = {
  NEW: "New",
  ASSIGNED: "Assigned",
  IN_PROGRESS: "In Progress",
  PENDING_3RD_PARTY: "Pending 3rd Party",
  ASSIGNED_TO_REQUESTER: "Assigned to requester",
  FIXED: "Fixed",
  BLOCKED_BY: "Blocked by",
  DUPLICATE_OF: "Duplicate of",
};

/** Which template status each backend status shows as. CANCELLED isn't on
 *  the list (cancelling stays a separate, elevated action). */
export const TEMPLATE_STATUS_FOR: Record<IncidentStatus, TemplateStatus | null> = {
  NEW: "NEW",
  ASSIGNED: "ASSIGNED",
  REOPENED: "ASSIGNED",
  ACKNOWLEDGED: "IN_PROGRESS",
  IN_PROGRESS: "IN_PROGRESS",
  PENDING_VENDOR: "PENDING_3RD_PARTY",
  PENDING_CUSTOMER: "ASSIGNED_TO_REQUESTER",
  RESOLVED: "FIXED",
  CLOSED: "FIXED",
  BLOCKED: "BLOCKED_BY",
  DUPLICATE: "DUPLICATE_OF",
  CANCELLED: null,
};

/** Longest chain a single pick may run (e.g. RESOLVED -> REOPENED -> IN_PROGRESS). */
const MAX_STEPS = 3;

/** States a chain may pass through on the way: the ordinary working
 *  pipeline only, never a pending, blocked, resolved or terminal state. */
const PASS_THROUGH: IncidentStatus[] = [
  IncidentStatus.ASSIGNED,
  IncidentStatus.ACKNOWLEDGED,
  IncidentStatus.REOPENED,
  IncidentStatus.IN_PROGRESS,
];

/**
 * Shortest chain of transitions from `from` to any status displayed as
 * `target`, using only rules `canUse` accepts. Null when the target is
 * already the current display status or can't be reached.
 */
export function planTemplateStatus(
  from: IncidentStatus,
  target: TemplateStatus,
  canUse: (rule: TransitionRule) => boolean,
): TransitionRule[] | null {
  if (TEMPLATE_STATUS_FOR[from] === target) {
    return null;
  }
  const queue: { status: IncidentStatus; path: TransitionRule[] }[] = [{ status: from, path: [] }];
  const seen = new Set<IncidentStatus>([from]);
  while (queue.length > 0) {
    const { status, path } = queue.shift()!;
    if (path.length >= MAX_STEPS) {
      continue;
    }
    for (const rule of TRANSITION_RULES) {
      if (!rule.from.includes(status) || seen.has(rule.to) || !canUse(rule)) {
        continue;
      }
      const next = [...path, rule];
      if (TEMPLATE_STATUS_FOR[rule.to] === target) {
        return next;
      }
      seen.add(rule.to);
      if (PASS_THROUGH.includes(rule.to)) {
        queue.push({ status: rule.to, path: next });
      }
    }
  }
  return null;
}

/** Every field the chain will ask for, in rule order, without repeats. */
export function fieldsForPath(path: TransitionRule[]): (keyof TransitionDto)[] {
  const fields: (keyof TransitionDto)[] = [];
  for (const rule of path) {
    const wanted: (keyof TransitionDto)[] = [...(rule.requiredFields ?? [])];
    if (rule.to === IncidentStatus.BLOCKED || rule.to === IncidentStatus.DUPLICATE) {
      wanted.push("refIncidentNo");
    }
    for (const f of wanted) {
      if (!fields.includes(f)) fields.push(f);
    }
  }
  return fields;
}
