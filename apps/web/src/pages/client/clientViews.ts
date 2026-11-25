import type { IncidentStatus } from "@cts-dc-opsdesk/shared-types";

/**
 * The client portal's left-nav views. Each one is a filter over the
 * tickets the customer reported, and each name says exactly what it
 * shows:
 *
 * - `reported`      — every ticket you reported.
 * - `assigned`      — the ones waiting on YOU: the desk asked you
 *                     something, or it says it's fixed and needs your
 *                     confirmation.
 * - `resolved`      — the ones you confirmed as fixed. A customer never
 *                     sets RESOLVED themselves (only staff transition),
 *                     so this is the "yes, it's fixed" answer you gave.
 * - `open`          — everything still being worked on.
 * - `resolved-all`  — everything that reached a fix (resolved or closed).
 *
 * `assigned` and `resolved` need to know whether the customer has
 * already answered "is it fixed?", which the API reports per ticket as
 * `feedback` (FIXED / NOT_FIXED / null).
 */
export type ClientTicketView = "reported" | "assigned" | "resolved" | "open" | "resolved-all";

export interface ClientTicketFeedback {
  outcome: "FIXED" | "NOT_FIXED";
  at: string;
}

export interface ClientViewTicket {
  id: string;
  status: IncidentStatus;
  /** The customer's own "is it fixed?" answer, if they've given one. */
  feedback?: ClientTicketFeedback | null;
}

/**
 * The statuses that mean the desk has finished working the ticket.
 * Typed as strings rather than IncidentStatus so `.includes()` accepts an
 * enum value — the same reason the rest of the client pages compare
 * statuses as plain strings.
 */
const FINISHED: readonly string[] = ["RESOLVED", "CLOSED"];

/** Statuses where the desk is still working, or waiting on the customer. */
const STILL_OPEN: readonly string[] = [
  "NEW",
  "ASSIGNED",
  "ACKNOWLEDGED",
  "IN_PROGRESS",
  "PENDING_VENDOR",
  "PENDING_CUSTOMER",
  "REOPENED",
  "BLOCKED",
];

/**
 * True when the next move is the customer's: the desk asked them
 * something (PENDING_CUSTOMER), or it says the ticket is fixed and is
 * waiting for them to confirm (RESOLVED without an answer yet).
 */
export function needsYou(ticket: ClientViewTicket): boolean {
  if (ticket.status === "PENDING_CUSTOMER") return true;
  return ticket.status === "RESOLVED" && !ticket.feedback;
}

/** True when the customer answered "yes, it's fixed". */
export function confirmedFixed(ticket: ClientViewTicket): boolean {
  return ticket.feedback?.outcome === "FIXED";
}

/** True when the ticket reached a fix — resolved or closed. */
export function isResolved(ticket: ClientViewTicket): boolean {
  return FINISHED.includes(ticket.status);
}

/** True when the ticket is still live (not resolved, closed or dead). */
export function isOpen(ticket: ClientViewTicket): boolean {
  return STILL_OPEN.includes(ticket.status);
}

/** Does this ticket belong in this view? */
export function matchesView(ticket: ClientViewTicket, view: ClientTicketView): boolean {
  switch (view) {
    case "assigned":
      return needsYou(ticket);
    case "resolved":
      return confirmedFixed(ticket);
    case "open":
      return isOpen(ticket);
    case "resolved-all":
      return isResolved(ticket);
    case "reported":
    default:
      return true;
  }
}

export interface ClientViewDefinition {
  value: ClientTicketView;
  label: string;
  /** One line explaining what this view contains. */
  hint: string;
}

/** The views in left-nav order, with the copy shown beside each tab. */
export const CLIENT_VIEWS: readonly ClientViewDefinition[] = [
  {
    value: "reported",
    label: "Reported by Me",
    hint: "Every ticket you've reported.",
  },
  {
    value: "assigned",
    label: "Assigned to Me",
    hint: "Tickets waiting on you to reply or confirm the fix.",
  },
  {
    value: "resolved",
    label: "Resolved by Me",
    hint: "Tickets you've confirmed as fixed.",
  },
  {
    value: "open",
    label: "All Open Tickets",
    hint: "Everything still being worked on.",
  },
  {
    value: "resolved-all",
    label: "All Resolved Tickets",
    hint: "Everything that reached a fix.",
  },
];

export function viewDefinition(view: ClientTicketView): ClientViewDefinition {
  return CLIENT_VIEWS.find((v) => v.value === view) ?? CLIENT_VIEWS[0];
}
