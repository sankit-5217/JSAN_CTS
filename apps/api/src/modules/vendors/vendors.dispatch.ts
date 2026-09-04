import type { DispatchStatus } from "./vendors.constants";

/**
 * RMA dispatch lifecycle. Linear from REQUESTED; RETURNED (the faulty part going
 * back) is only reachable once the replacement is physically present, and is
 * terminal. State transitions are a backend rule — the frontend never sets
 * `dispatchStatus` directly (CLAUDE.md).
 */
const TRANSITIONS: Record<DispatchStatus, readonly DispatchStatus[]> = {
  REQUESTED: ["APPROVED"],
  APPROVED: ["SHIPPED"],
  SHIPPED: ["DELIVERED"],
  DELIVERED: ["INSTALLED", "RETURNED"],
  INSTALLED: ["RETURNED"],
  RETURNED: [],
};

export function canTransitionDispatch(from: DispatchStatus | null, to: DispatchStatus): boolean {
  if (from === null) {
    return to === "REQUESTED";
  }
  return TRANSITIONS[from].includes(to);
}
