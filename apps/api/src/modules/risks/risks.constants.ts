/**
 * Risk-register vocabulary. `score` is `likelihood * impact` on a 1–5 scale
 * (1–25) and is computed backend-side — the client never sends it. `severity`
 * is a band derived from `score` at read time (see `risks.scoring.ts`), not
 * stored. `status` is the string in `risks.status`.
 */
export const RISK_LEVEL_MIN = 1;
export const RISK_LEVEL_MAX = 5;

export type RiskStatus = "OPEN" | "MITIGATING" | "ACCEPTED" | "CLOSED";
export const RISK_STATUSES: readonly RiskStatus[] = ["OPEN", "MITIGATING", "ACCEPTED", "CLOSED"];

export type RiskSeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export const RISK_SEVERITIES: readonly RiskSeverity[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

/** Named read-side views for `GET /risks` (avoids boolean query params). */
export type RiskView = "overdue";
export const RISK_VIEWS: readonly RiskView[] = ["overdue"];
