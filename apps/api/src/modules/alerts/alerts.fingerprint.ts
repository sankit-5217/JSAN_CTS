import { createHash } from "node:crypto";

export interface AlertFingerprintInput {
  siteCode: string;
  ciCode: string;
  alertType: string;
  componentKey?: string | null;
}

/**
 * Stable dedup key for an alert: sha256 over the normalized
 * site + CI + alert type + component tuple (build spec §10.9, CLAUDE.md
 * "Idempotent integrations"). Deliberately independent of severity, wording
 * and timestamps so a flapping condition collapses onto a single fingerprint.
 */
export function computeAlertFingerprint(input: AlertFingerprintInput): string {
  const normalized = [input.siteCode, input.ciCode, input.alertType, input.componentKey ?? ""]
    .map((part) => part.trim().toLowerCase())
    .join("|");
  return createHash("sha256").update(normalized).digest("hex");
}
