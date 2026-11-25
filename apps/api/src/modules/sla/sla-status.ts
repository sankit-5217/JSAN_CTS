import { SlaInstance } from "@prisma/client";

export type SlaClockState = "ON_TRACK" | "AT_RISK" | "BREACHED" | "PAUSED" | "MET";

export interface SlaClock {
  state: SlaClockState;
  /** Null while paused: the due time moves forward when the clock resumes. */
  dueAt: Date | null;
  completedAt: Date | null;
}

export interface SlaStatus {
  response: SlaClock;
  resolution: SlaClock;
  /** The worst of the two clocks, for a single badge. */
  overall: SlaClockState;
}

export type SlaStatusInput = Pick<
  SlaInstance,
  "ackDueAt" | "ackedAt" | "resolveDueAt" | "resolvedAt" | "pausedAt" | "firedMilestones"
>;

const STATE_RANK: Record<SlaClockState, number> = {
  MET: 0,
  ON_TRACK: 1,
  PAUSED: 2,
  AT_RISK: 3,
  BREACHED: 4,
};

function clockState(
  kind: "ACK" | "RESOLVE",
  dueAt: Date | null,
  completedAt: Date | null,
  paused: boolean,
  firedMilestones: string[],
  now: Date,
): SlaClockState {
  const breachFired = firedMilestones.includes(`${kind}_BREACH`);
  if (completedAt) {
    return breachFired || (dueAt !== null && completedAt > dueAt) ? "BREACHED" : "MET";
  }
  if (breachFired) {
    return "BREACHED";
  }
  if (paused) {
    return "PAUSED";
  }
  // The scanner runs every minute, so a clock can be past due before its
  // BREACH milestone is recorded.
  if (dueAt !== null && now > dueAt) {
    return "BREACHED";
  }
  // "At risk" is a warning threshold already fired by SlaEscalationScanner
  // from the policy's own escalationThresholdsPercent, never a number here.
  return firedMilestones.some((m) => m.startsWith(`${kind}_`)) ? "AT_RISK" : "ON_TRACK";
}

/**
 * Where an incident's response and resolution clocks stand right now, read
 * off the stored SlaInstance (due dates, pause window, fired milestones).
 * Only the resolution clock pauses (see SlaService.onPaused).
 */
export function deriveSlaStatus(instance: SlaStatusInput, now: Date = new Date()): SlaStatus {
  const responseState = clockState(
    "ACK",
    instance.ackDueAt,
    instance.ackedAt,
    false,
    instance.firedMilestones,
    now,
  );
  const resolutionState = clockState(
    "RESOLVE",
    instance.resolveDueAt,
    instance.resolvedAt,
    instance.pausedAt !== null,
    instance.firedMilestones,
    now,
  );
  return {
    response: { state: responseState, dueAt: instance.ackDueAt, completedAt: instance.ackedAt },
    resolution: {
      state: resolutionState,
      dueAt: resolutionState === "PAUSED" ? null : instance.resolveDueAt,
      completedAt: instance.resolvedAt,
    },
    overall:
      STATE_RANK[responseState] > STATE_RANK[resolutionState] ? responseState : resolutionState,
  };
}
