import type { NormalizedAlertPayload } from "@cts-dc-opsdesk/shared-types";
import type { AlertmanagerAlert, AlertmanagerWebhook } from "./types";

/** Thrown when an Alertmanager alert cannot be mapped onto the OpsDesk alert contract. */
export class AlertNormalizationError extends Error {
  constructor(
    message: string,
    readonly field: string,
    readonly index?: number,
  ) {
    super(message);
    this.name = "AlertNormalizationError";
  }
}

/** Outcome of normalizing a full webhook delivery. */
export interface NormalizationResult {
  normalized: NormalizedAlertPayload[];
  /** Per-alert failures; the rest of the delivery is still normalized. */
  errors: AlertNormalizationError[];
}

type Severity = NormalizedAlertPayload["severity"];

const LABEL_TO_SEVERITY: Record<string, Severity> = {
  critical: "CRITICAL",
  page: "CRITICAL",
  error: "HIGH",
  high: "HIGH",
  warning: "WARNING",
  warn: "WARNING",
  info: "INFO",
  information: "INFO",
  none: "INFO",
};

function resolveSeverity(labels: Record<string, string>): Severity {
  const raw = labels.severity?.trim().toLowerCase();
  if (!raw) {
    return "WARNING";
  }
  return LABEL_TO_SEVERITY[raw] ?? "WARNING";
}

/** RFC 3339 -> unix epoch seconds, or NaN when unparseable. */
function epochSeconds(rfc3339: string | undefined): number {
  if (!rfc3339) {
    return NaN;
  }
  const ms = Date.parse(rfc3339);
  return Number.isNaN(ms) ? NaN : Math.floor(ms / 1000);
}

function requireLabel(
  labels: Record<string, string>,
  key: string,
  context: string,
  index: number | undefined,
): string {
  const value = labels[key]?.trim();
  if (!value) {
    throw new AlertNormalizationError(`${context} is missing the "${key}" label`, key, index);
  }
  return value;
}

/**
 * Normalize a single Alertmanager alert. Pure and deterministic — no I/O.
 * Throws {@link AlertNormalizationError} when a required label or timestamp is
 * absent or malformed.
 */
export function normalizeAlertmanagerAlert(
  alert: AlertmanagerAlert,
  index?: number,
): NormalizedAlertPayload {
  const labels = alert.labels ?? {};
  const annotations = alert.annotations ?? {};

  const alertName = requireLabel(labels, "alertname", "Alertmanager alert", index);
  const siteCode = requireLabel(labels, "site", `Alertmanager alert ${alertName}`, index);
  const ciCode = requireLabel(labels, "ci", `Alertmanager alert ${alertName}`, index);

  const fingerprint = alert.fingerprint?.trim();
  if (!fingerprint) {
    throw new AlertNormalizationError(
      `Alertmanager alert ${alertName} is missing a fingerprint`,
      "fingerprint",
      index,
    );
  }

  const startEpoch = epochSeconds(alert.startsAt);
  if (Number.isNaN(startEpoch) || startEpoch <= 0) {
    throw new AlertNormalizationError(
      `Alertmanager alert ${alertName} has an unparseable startsAt "${alert.startsAt}"`,
      "startsAt",
      index,
    );
  }

  const resolved = alert.status === "resolved";
  const endEpoch = epochSeconds(alert.endsAt);
  const occurredEpoch = resolved && !Number.isNaN(endEpoch) && endEpoch > 0 ? endEpoch : startEpoch;

  return {
    // one alert row per firing episode: fingerprint is stable per series, and
    // startsAt ties a "resolved" delivery back to the firing it closes.
    eventId: `prom-${fingerprint}-${startEpoch}`,
    source: "PROMETHEUS",
    siteCode,
    ciCode,
    alertType: alertName,
    severity: resolveSeverity(labels),
    componentKey:
      labels.component?.trim() || labels.device?.trim() || labels.instance?.trim() || undefined,
    occurredAt: new Date(occurredEpoch * 1000).toISOString(),
    state: resolved ? "RECOVERED" : "OPEN",
    summary:
      annotations.summary?.trim() ||
      annotations.description?.trim() ||
      annotations.message?.trim() ||
      alertName,
    attributes: {
      alertmanagerFingerprint: fingerprint,
      generatorURL: alert.generatorURL,
      labels,
    },
  };
}

/**
 * Normalize a full Alertmanager webhook delivery. Per-alert failures are
 * collected in `errors` rather than aborting the batch, so one malformed alert
 * does not drop the rest of the delivery. Throws only when the envelope itself
 * is unusable.
 */
export function normalizeAlertmanagerWebhook(payload: AlertmanagerWebhook): NormalizationResult {
  if (!payload || !Array.isArray(payload.alerts)) {
    throw new AlertNormalizationError('webhook payload has no "alerts" array', "alerts");
  }

  const result: NormalizationResult = { normalized: [], errors: [] };
  payload.alerts.forEach((alert, index) => {
    try {
      result.normalized.push(normalizeAlertmanagerAlert(alert, index));
    } catch (err) {
      if (err instanceof AlertNormalizationError) {
        result.errors.push(err);
        return;
      }
      throw err;
    }
  });
  return result;
}
