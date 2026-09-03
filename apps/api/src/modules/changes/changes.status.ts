import type { ChangeStatus, ChangeType } from "./changes.constants";

/** The Change fields this module derives status from. */
export interface ChangeStatusInput {
  approverId: string | null;
  windowStart: Date;
  windowEnd: Date;
  outcome: string | null;
  changeType: ChangeType;
}

/**
 * Derive the workflow status of a change. The schema has no status column, so it
 * is a function of: approved yet? window in the past/now/future? outcome recorded?
 */
export function deriveChangeStatus(
  change: ChangeStatusInput,
  now: Date = new Date(),
): ChangeStatus {
  if (change.outcome !== null && change.outcome !== "") {
    return "COMPLETED";
  }
  if (change.approverId === null) {
    return "PENDING_APPROVAL";
  }
  const t = now.getTime();
  if (t < change.windowStart.getTime()) {
    return "SCHEDULED";
  }
  if (t <= change.windowEnd.getTime()) {
    return "IN_PROGRESS";
  }
  return "PENDING_REVIEW";
}

/** Emergency changes require a post-implementation review — outcome is mandatory once the window closes. */
export function isPirOverdue(change: ChangeStatusInput, now: Date = new Date()): boolean {
  return (
    change.changeType === "EMERGENCY" &&
    (change.outcome === null || change.outcome === "") &&
    now.getTime() > change.windowEnd.getTime()
  );
}

/** Plan / window edits are only accepted before work starts. */
export function isEditable(status: ChangeStatus): boolean {
  return status === "PENDING_APPROVAL" || status === "SCHEDULED";
}
