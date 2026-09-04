import type { ProblemStatus } from "./problems.constants";

/**
 * Problem lifecycle (spec §10.5). Deliberately forgiving — RCA is iterative,
 * so investigation can be re-opened from any later state — but a few rules
 * hold: you can't jump straight from OPEN to RESOLVED without investigating,
 * and CLOSED only re-opens back into INVESTIGATING.
 */
const ALLOWED: Record<ProblemStatus, readonly ProblemStatus[]> = {
  OPEN: ["INVESTIGATING", "CLOSED"],
  INVESTIGATING: ["KNOWN_ERROR", "RESOLVED", "OPEN"],
  KNOWN_ERROR: ["RESOLVED", "INVESTIGATING"],
  RESOLVED: ["CLOSED", "INVESTIGATING"],
  CLOSED: ["INVESTIGATING"],
};

export function canTransitionProblem(from: ProblemStatus, to: ProblemStatus): boolean {
  return ALLOWED[from].includes(to);
}

/**
 * Fields that must already be set on the problem before it may enter `to`.
 * A root cause is mandatory to mark a problem RESOLVED — same "evidence before
 * closure" rule the incident state machine applies (spec §10.3).
 */
export function requiredFieldsForProblemStatus(to: ProblemStatus): readonly string[] {
  if (to === "RESOLVED") {
    return ["rootCause"];
  }
  return [];
}
