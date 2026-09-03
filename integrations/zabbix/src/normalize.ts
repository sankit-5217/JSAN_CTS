import type { NormalizedAlertPayload } from "@cts-dc-opsdesk/shared-types";
import type { ZabbixWebhookEvent } from "./types";

/** Thrown when a Zabbix event cannot be mapped onto the OpsDesk alert contract. */
export class AlertNormalizationError extends Error {
  constructor(
    message: string,
    readonly field: string,
  ) {
    super(message);
    this.name = "AlertNormalizationError";
  }
}

type Severity = NormalizedAlertPayload["severity"];
type State = NormalizedAlertPayload["state"];

/** `{EVENT.NSEVERITY}` 0..5 -> OpsDesk severity. */
const NSEVERITY_TO_SEVERITY: Record<string, Severity> = {
  "0": "INFO",
  "1": "INFO",
  "2": "WARNING",
  "3": "HIGH",
  "4": "HIGH",
  "5": "CRITICAL",
};

/** `{EVENT.SEVERITY}` textual -> OpsDesk severity (fallback when nseverity is absent). */
const TEXT_TO_SEVERITY: Record<string, Severity> = {
  "not classified": "INFO",
  information: "INFO",
  warning: "WARNING",
  average: "HIGH",
  high: "HIGH",
  disaster: "CRITICAL",
};

function resolveSeverity(event: ZabbixWebhookEvent): Severity {
  const byNumber = event.nseverity ? NSEVERITY_TO_SEVERITY[event.nseverity.trim()] : undefined;
  if (byNumber) {
    return byNumber;
  }
  const byText = event.severity ? TEXT_TO_SEVERITY[event.severity.trim().toLowerCase()] : undefined;
  return byText ?? "WARNING";
}

function resolveState(event: ZabbixWebhookEvent): State {
  if (event.eventValue.trim() === "0") {
    return "RECOVERED";
  }
  if (event.eventAckStatus?.trim().toLowerCase() === "yes") {
    return "ACKNOWLEDGED";
  }
  if (event.eventUpdateStatus?.trim() === "1") {
    return "ACKNOWLEDGED";
  }
  return "OPEN";
}

function slug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Best-effort site code from a `SITE01-...` style host name. */
function siteFromHost(host: string): string | undefined {
  const match = host.match(/^([A-Za-z0-9]+?)[-_]/);
  return match?.[1];
}

function required(value: string | undefined, field: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new AlertNormalizationError(`Zabbix event is missing required field "${field}"`, field);
  }
  return trimmed;
}

/**
 * Normalize one Zabbix webhook event into the OpsDesk alert contract. Pure and
 * deterministic — no I/O. Throws {@link AlertNormalizationError} when a required
 * field is absent or malformed; the caller decides whether to drop or dead-letter
 * the event.
 */
export function normalizeZabbixEvent(event: ZabbixWebhookEvent): NormalizedAlertPayload {
  const eventId = required(event.eventId, "eventId");
  const host = required(event.host, "host");
  const name = required(event.name, "name");
  const rawTimestamp = required(event.timestamp, "timestamp");

  const epochSeconds = Number(rawTimestamp);
  if (!Number.isFinite(epochSeconds) || epochSeconds <= 0) {
    throw new AlertNormalizationError(
      `Zabbix event ${eventId} has a non-numeric timestamp "${event.timestamp}"`,
      "timestamp",
    );
  }

  const tags = event.tags ?? {};
  const siteCode = tags.site?.trim() || siteFromHost(host);
  if (!siteCode) {
    throw new AlertNormalizationError(
      `Zabbix event ${eventId} has no "site" tag and no site prefix on host "${host}"`,
      "site",
    );
  }

  const ciCode = tags.ci?.trim() || host;
  const alertType = tags.alertType?.trim() || event.itemKey?.trim() || slug(name);
  const componentKey = tags.component?.trim() || event.itemKey?.trim() || undefined;

  return {
    eventId: `zbx-${eventId}`,
    source: "ZABBIX",
    siteCode,
    ciCode,
    alertType,
    severity: resolveSeverity(event),
    componentKey,
    occurredAt: new Date(epochSeconds * 1000).toISOString(),
    state: resolveState(event),
    summary: event.opdata?.trim() ? `${name} — ${event.opdata.trim()}` : name,
    attributes: {
      zabbixEventId: eventId,
      host,
      hostName: event.hostName,
      triggerId: event.triggerId,
      itemKey: event.itemKey,
      zabbixSeverity: event.severity,
      zabbixNSeverity: event.nseverity,
      tags,
    },
  };
}
