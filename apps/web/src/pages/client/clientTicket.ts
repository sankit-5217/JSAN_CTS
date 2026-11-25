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
  BLOCKED: "Blocked by another ticket",
  DUPLICATE: "Duplicate of another ticket",
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
  BLOCKED: "warning",
  DUPLICATE: "default",
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

export function isFinished(status: IncidentStatus): boolean {
  return status === "CLOSED" || status === "CANCELLED" || status === "DUPLICATE";
}

/** GET /incidents/:id/progress (IncidentCustomerService.getProgress). */
export interface TicketProgress {
  status: IncidentStatus;
  handledBy: { engineer: string | null; team: string | null };
  milestones: { status: IncidentStatus; at: string }[];
  waitingOnCustomerSince: string | null;
  customerRepliedWhileWaiting: boolean;
  feedback: { outcome: "FIXED" | "NOT_FIXED"; at: string } | null;
  /** The reporter's edits to their report, oldest first (GET :id/progress). */
  reportEdits?: ReportEdit[];
}

/** One saved edit of the report: who, when, each field's old → new value. */
export interface ReportEdit {
  at: string;
  by: { name: string; email?: string | null; role: string | null } | null;
  /** False for edits saved before values were recorded: field names only. */
  detailed: boolean;
  changes: { label: string; from: string | null; to: string | null }[];
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

/** One entry of a ticket's conversation, in time order. */
export type ConversationItem<C extends { createdAt: string }> =
  | { type: "comment"; at: string; comment: C }
  | { type: "status"; at: string; status: IncidentStatus }
  | { type: "edit"; at: string; edit: ReportEdit };

/**
 * The conversation both portals show: messages, status changes (after the
 * ticket was raised) and the reporter's report edits, oldest first. Edits
 * with nothing readable to show are left out.
 */
export function buildConversation<C extends { createdAt: string }>(
  comments: C[],
  progress: Pick<TicketProgress, "milestones" | "reportEdits"> | null,
  opts: { statuses?: boolean } = {},
): ConversationItem<C>[] {
  const items: ConversationItem<C>[] = comments.map((c) => ({
    type: "comment",
    at: c.createdAt,
    comment: c,
  }));
  if (opts.statuses !== false) {
    // The first milestone is the ticket being created: the report itself.
    for (const m of progress?.milestones.slice(1) ?? []) {
      items.push({ type: "status", at: m.at, status: m.status });
    }
  }
  for (const edit of progress?.reportEdits ?? []) {
    if (edit.changes.length > 0) items.push({ type: "edit", at: edit.at, edit });
  }
  items.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  return mergeEditRuns(items);
}

/** Who saved an edit, for telling one editor's run from the next. */
function editorKey(edit: ReportEdit): string {
  return edit.by ? (edit.by.email ?? edit.by.name) : "";
}

/**
 * Back-to-back report edits by the same person become one box: every
 * field they changed, each from its first old value to its last new one,
 * timed at their latest save. Another person's edit, a message or a
 * status change in between starts a new box.
 */
function mergeEditRuns<C extends { createdAt: string }>(
  items: ConversationItem<C>[],
): ConversationItem<C>[] {
  const out: ConversationItem<C>[] = [];
  for (const item of items) {
    const prev = out[out.length - 1];
    if (
      item.type === "edit" &&
      prev?.type === "edit" &&
      editorKey(prev.edit) === editorKey(item.edit)
    ) {
      const changes = prev.edit.changes.map((c) => ({ ...c }));
      for (const c of item.edit.changes) {
        const seen = changes.find((x) => x.label === c.label);
        if (seen) seen.to = c.to;
        else changes.push({ ...c });
      }
      out[out.length - 1] = {
        type: "edit",
        at: item.at,
        edit: {
          ...item.edit,
          detailed: prev.edit.detailed && item.edit.detailed,
          changes,
        },
      };
    } else {
      out.push(item);
    }
  }
  return out;
}
