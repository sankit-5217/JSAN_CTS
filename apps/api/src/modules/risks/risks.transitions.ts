import type { RiskStatus } from "./risks.constants";

/**
 * Risk-register lifecycle. A risk is raised OPEN; work on it is MITIGATING;
 * ACCEPTED means the residual risk is formally owned with no further action;
 * CLOSED means resolved or no longer relevant. Any state can be re-opened.
 * State transitions are a backend rule — the frontend never sets `status`
 * directly (CLAUDE.md).
 */
const TRANSITIONS: Record<RiskStatus, readonly RiskStatus[]> = {
  OPEN: ["MITIGATING", "ACCEPTED", "CLOSED"],
  MITIGATING: ["OPEN", "ACCEPTED", "CLOSED"],
  ACCEPTED: ["OPEN", "CLOSED"],
  CLOSED: ["OPEN"],
};

export function canTransitionRiskStatus(from: RiskStatus | null, to: RiskStatus): boolean {
  if (from === null) {
    return to === "OPEN";
  }
  if (from === to) {
    return false;
  }
  return TRANSITIONS[from].includes(to);
}

/** The states reachable from `from` — for building a helpful error message. */
export function allowedRiskTransitions(from: RiskStatus): readonly RiskStatus[] {
  return TRANSITIONS[from];
}
