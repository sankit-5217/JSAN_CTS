/**
 * Change vocabulary. `ChangeType` matches the Prisma enum; `ChangeStatus` is
 * *derived* at read time from approverId / window times / outcome (the schema
 * stores no status column) — see `changes.status.ts`.
 */
export type ChangeType = "STANDARD" | "NORMAL" | "EMERGENCY";
export const CHANGE_TYPES: readonly ChangeType[] = ["STANDARD", "NORMAL", "EMERGENCY"];

export type ChangeStatus =
  "PENDING_APPROVAL" | "SCHEDULED" | "IN_PROGRESS" | "PENDING_REVIEW" | "COMPLETED";
export const CHANGE_STATUSES: readonly ChangeStatus[] = [
  "PENDING_APPROVAL",
  "SCHEDULED",
  "IN_PROGRESS",
  "PENDING_REVIEW",
  "COMPLETED",
];
