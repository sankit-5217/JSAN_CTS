/** Test-cadence readiness of a BCP plan, derived from its test dates (spec §10.16). */
export type BcpReadiness = "UNTESTED" | "DUE" | "READY";

export interface BcpReadinessInput {
  lastTestedAt: Date | null;
  nextTestDueAt: Date | null;
}

export interface BcpReadinessView {
  readiness: BcpReadiness;
  /** Never tested — no `lastTestedAt`. */
  neverTested: boolean;
  /** `nextTestDueAt` is in the past. */
  testOverdue: boolean;
}

/**
 * A plan is UNTESTED until it has a first test on record, DUE once its next
 * test date has passed, and READY otherwise. A plan with no `nextTestDueAt`
 * set is never DUE (nothing scheduled to be overdue against).
 */
export function deriveBcpReadiness(
  plan: BcpReadinessInput,
  now: Date = new Date(),
): BcpReadinessView {
  const neverTested = plan.lastTestedAt === null;
  const testOverdue = plan.nextTestDueAt !== null && plan.nextTestDueAt.getTime() < now.getTime();

  let readiness: BcpReadiness = "READY";
  if (neverTested) {
    readiness = "UNTESTED";
  } else if (testOverdue) {
    readiness = "DUE";
  }

  return { readiness, neverTested, testOverdue };
}
