// Type-only: the shared-types build the browser loads carries no runtime
// enum objects, so statuses are compared as their string values.
import type { IncidentStatus, Priority } from "@cts-dc-opsdesk/shared-types";

/** Plain-language status labels for a non-technical audience. Backend
 *  statuses are the source of truth (spec §15); this is presentation only. */
export const STATUS_LABEL: Record<IncidentStatus, string> = {
  NEW: "Received",
  ASSIGNED: "Assigned to an engineer",
  ACKNOWLEDGED: "Being worked on",
  IN_PROGRESS: "In progress",
  PENDING_VENDOR: "Waiting on a vendor",
  PENDING_CUSTOMER: "Waiting on your input",
  RESOLVED: "Resolved: please confirm",
  CLOSED: "Closed",
  REOPENED: "Reopened",
  CANCELLED: "Cancelled",
};

export const STATUS_COLOR: Record<
  IncidentStatus,
  "info" | "warning" | "success" | "default" | "error"
> = {
  NEW: "info",
  ASSIGNED: "info",
  ACKNOWLEDGED: "info",
  IN_PROGRESS: "info",
  PENDING_VENDOR: "default",
  PENDING_CUSTOMER: "warning",
  RESOLVED: "success",
  CLOSED: "default",
  REOPENED: "warning",
  CANCELLED: "default",
};

export const PRIORITY_LABEL: Record<Priority, string> = {
  P1: "Critical",
  P2: "High",
  P3: "Standard",
  P4: "Low",
};

/** Statuses where the next move is the customer's. */
export function needsCustomer(status: IncidentStatus): boolean {
  return status === "PENDING_CUSTOMER" || status === "RESOLVED";
}

/** Waiting on the customer: a question to answer, or a resolved ticket
 *  they haven't said is fixed (or not) yet. */
export function needsYou(inc: { id: string; status: IncidentStatus }, answered: Set<string>) {
  return needsCustomer(inc.status) && !answered.has(inc.id);
}

export function isFinished(status: IncidentStatus): boolean {
  return status === "CLOSED" || status === "CANCELLED";
}

/** GET /incidents/:id/progress (IncidentCustomerService.getProgress). */
export interface TicketProgress {
  status: IncidentStatus;
  handledBy: { engineer: string | null; team: string | null };
  milestones: { status: IncidentStatus; at: string }[];
  waitingOnCustomerSince: string | null;
  customerRepliedWhileWaiting: boolean;
  feedback: { outcome: "FIXED" | "NOT_FIXED"; at: string } | null;
}

/** The customer-facing journey, in order. Pending and reopened states sit
 *  on top of whichever step the ticket had reached. */
export const JOURNEY: { label: string; reachedBy: readonly `${IncidentStatus}`[] }[] = [
  { label: "Received", reachedBy: ["NEW"] },
  { label: "Assigned", reachedBy: ["ASSIGNED"] },
  { label: "Being worked on", reachedBy: ["ACKNOWLEDGED", "IN_PROGRESS"] },
  { label: "Resolved", reachedBy: ["RESOLVED"] },
  { label: "Closed", reachedBy: ["CLOSED"] },
];

/** Index of the furthest journey step the ticket has reached. Reopening
 *  drops it back to "Being worked on". */
export function journeyStep(milestones: { status: IncidentStatus }[]): number {
  let step = 0;
  for (const m of milestones) {
    if (m.status === "REOPENED") {
      step = 2;
      continue;
    }
    const idx = JOURNEY.findIndex((j) => j.reachedBy.includes(m.status));
    if (idx > step) {
      step = idx;
    }
  }
  return step;
}

export function relativeTime(iso: string, now = Date.now()): string {
  const minutes = Math.round((now - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}
