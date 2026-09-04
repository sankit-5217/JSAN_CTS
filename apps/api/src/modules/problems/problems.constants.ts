/**
 * Problem/RCA vocabulary (spec §10.5). `ProblemStatus` / `ProblemLinkType`
 * match the Prisma enums of the same name.
 */
export type ProblemStatus = "OPEN" | "INVESTIGATING" | "KNOWN_ERROR" | "RESOLVED" | "CLOSED";
export const PROBLEM_STATUSES: readonly ProblemStatus[] = [
  "OPEN",
  "INVESTIGATING",
  "KNOWN_ERROR",
  "RESOLVED",
  "CLOSED",
];

export type ProblemLinkType = "INCIDENT" | "CHANGE";
export const PROBLEM_LINK_TYPES: readonly ProblemLinkType[] = ["INCIDENT", "CHANGE"];
