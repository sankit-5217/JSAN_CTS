import { RISK_LEVEL_MAX, RISK_LEVEL_MIN } from "./risks.constants";
import type { RiskSeverity } from "./risks.constants";

/**
 * 5×5 risk matrix. `likelihood` and `impact` are each 1–5, so `score` is 1–25.
 * The severity bands below are the standard 5×5 cut points; if the operation
 * ever needs to tune them they should move to a config table (CLAUDE.md:
 * configuration over hard-code) — kept here as the single source for now.
 */
const SEVERITY_BANDS: ReadonlyArray<{ severity: RiskSeverity; min: number; max: number }> = [
  { severity: "LOW", min: 1, max: 4 },
  { severity: "MEDIUM", min: 5, max: 9 },
  { severity: "HIGH", min: 10, max: 14 },
  { severity: "CRITICAL", min: 15, max: 25 },
];

function assertLevel(name: string, value: number): void {
  if (!Number.isInteger(value) || value < RISK_LEVEL_MIN || value > RISK_LEVEL_MAX) {
    throw new RangeError(`${name} must be an integer ${RISK_LEVEL_MIN}–${RISK_LEVEL_MAX}`);
  }
}

/** `likelihood * impact`, each validated to the 1–5 scale. */
export function computeRiskScore(likelihood: number, impact: number): number {
  assertLevel("likelihood", likelihood);
  assertLevel("impact", impact);
  return likelihood * impact;
}

/** Band a raw score (1–25) into a severity. */
export function severityForScore(score: number): RiskSeverity {
  const band = SEVERITY_BANDS.find((b) => score >= b.min && score <= b.max);
  return band ? band.severity : "CRITICAL";
}

/** Inclusive score range for a severity — used to translate a `severity`
 *  filter into a `where` clause on the stored `score` column. */
export function scoreRangeForSeverity(severity: RiskSeverity): { min: number; max: number } {
  const band = SEVERITY_BANDS.find((b) => b.severity === severity);
  // Every RiskSeverity has a band; the fallback keeps the type total.
  return band ? { min: band.min, max: band.max } : { min: 1, max: 25 };
}

/** The Risk fields the read-time view is derived from. */
export interface RiskViewInput {
  score: number;
  status: string;
  dueDate: Date | null;
}

export interface RiskView {
  severity: RiskSeverity;
  /** Past its due date and not yet CLOSED. */
  overdue: boolean;
}

export function deriveRiskView(risk: RiskViewInput, now: Date = new Date()): RiskView {
  return {
    severity: severityForScore(risk.score),
    overdue:
      risk.status !== "CLOSED" && risk.dueDate !== null && risk.dueDate.getTime() < now.getTime(),
  };
}
