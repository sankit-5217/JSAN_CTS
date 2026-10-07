import type { HealthComponentKind } from "@cts-dc-opsdesk/shared-types";
import type { AlertSeverity } from "../alerts/alerts.constants";
import { HealthSnapshotDto } from "./dto/health-snapshot.dto";

/**
 * Turns one hardware health snapshot into per-component alert actions: every
 * degraded drive / PSU / fan / sensor gets its own alert that opens, updates
 * and recovers independently, so a second failure while the first is still
 * open is its own visible alert rather than hidden inside a server rollup.
 * Pure — MonitoringService persists the plan and runs it through AlertsService.
 */

/** One open per-component alert, as stored in `HealthSnapshot.openAlerts`. */
export interface OpenComponentAlert {
  eventId: string;
  alertType: string;
  componentKey: string;
  kind: HealthComponentKind;
}

/** `HealthSnapshot.openAlerts`: keyed by {@link conditionKey}. */
export type OpenComponentAlerts = Record<string, OpenComponentAlert>;

export interface ComponentAlertRaise {
  eventId: string;
  alertType: string;
  componentKey: string;
  severity: AlertSeverity;
  summary: string;
  attributes: Record<string, unknown>;
}

export interface ComponentAlertRecover {
  eventId: string;
  alertType: string;
  componentKey: string;
}

export interface ComponentAlertPlan {
  /** What `HealthSnapshot.openAlerts` should hold after this snapshot. */
  next: OpenComponentAlerts;
  raise: ComponentAlertRaise[];
  recover: ComponentAlertRecover[];
}

/** Server-level fallback, raised only when the snapshot is WARNING/CRITICAL
 *  but names no specific failing part. Same alertType the single rollup alert
 *  used before per-component alerts existed. */
export const HARDWARE_ROLLUP_ALERT_TYPE = "hardware.health_degraded";

/** Fits `alerts.component_key` (VARCHAR 128). */
const MAX_COMPONENT_KEY = 128;

const ALERTABLE: readonly string[] = ["WARNING", "CRITICAL"];

const KIND_LABEL: Record<HealthComponentKind, string> = {
  SYSTEM: "System",
  PROCESSOR: "Processor",
  MEMORY: "Memory",
  STORAGE_CONTROLLER: "Storage controller",
  DRIVE: "Drive",
  FAN: "Fan",
  POWER_SUPPLY: "Power supply",
  TEMPERATURE_SENSOR: "Temperature",
  NETWORK: "Network",
};

export function componentKeyFor(kind: HealthComponentKind, name: string): string {
  return `${kind}:${name}`.slice(0, MAX_COMPONENT_KEY);
}

export function conditionKey(alertType: string, componentKey: string): string {
  return `${alertType}|${componentKey}`;
}

/**
 * Was this kind of component actually read in this snapshot? A Storage or
 * Power collection that failed to load lists no drives / PSUs at all — that
 * must not read as "the failed drive is healthy again" and recover its alert.
 * Kinds without a count come from the always-required System resource.
 */
function kindObserved(kind: HealthComponentKind, snap: HealthSnapshotDto): boolean {
  switch (kind) {
    case "DRIVE":
      return (snap.summary?.drives?.total ?? 0) > 0;
    case "FAN":
      return (snap.summary?.fans?.total ?? 0) > 0;
    case "POWER_SUPPLY":
      return (snap.summary?.powerSupplies?.total ?? 0) > 0;
    default:
      return true;
  }
}

/** The failing conditions this snapshot reports, keyed by {@link conditionKey}. */
function currentConditions(
  snap: HealthSnapshotDto,
): Map<string, Omit<ComponentAlertRaise, "eventId"> & { kind: HealthComponentKind }> {
  const out = new Map<
    string,
    Omit<ComponentAlertRaise, "eventId"> & { kind: HealthComponentKind }
  >();
  const add = (
    kind: HealthComponentKind,
    alertType: string,
    componentKey: string,
    severity: AlertSeverity,
    summary: string,
    attributes: Record<string, unknown>,
  ) => {
    out.set(conditionKey(alertType, componentKey), {
      kind,
      alertType,
      componentKey,
      severity,
      summary: summary.slice(0, 500),
      attributes: { healthSnapshotSource: snap.source, ...attributes },
    });
  };

  // The server's own rollup status only echoes its parts (or a predictive
  // failure). It never gets an alert of its own; when nothing specific is
  // named, the server-level fallback below covers it.
  const parts = snap.degraded.filter((d) => ALERTABLE.includes(d.health) && !d.rollup);
  for (const d of parts) {
    add(
      d.kind,
      `hardware.${d.kind.toLowerCase()}_degraded`,
      componentKeyFor(d.kind, d.name),
      d.health as AlertSeverity,
      `${KIND_LABEL[d.kind]} ${d.name} ${d.health}${d.detail ? ` — ${d.detail}` : ""}`,
      { component: d },
    );
  }

  for (const p of snap.predictiveFailures) {
    add(
      p.kind,
      `hardware.${p.kind.toLowerCase()}_predictive_failure`,
      componentKeyFor(p.kind, p.name),
      "WARNING",
      `${KIND_LABEL[p.kind]} ${p.name} predicted to fail${p.detail ? ` — ${p.detail}` : ""}`,
      { predictiveFailure: p },
    );
  }

  if (out.size === 0 && ALERTABLE.includes(snap.overallHealth)) {
    add(
      "SYSTEM",
      HARDWARE_ROLLUP_ALERT_TYPE,
      "SYSTEM",
      snap.overallHealth as AlertSeverity,
      `${snap.source} reports overall health ${snap.overallHealth}`,
      { overallHealth: snap.overallHealth },
    );
  }
  return out;
}

/**
 * Plan the alert actions for one snapshot against what is currently open.
 * - UNKNOWN / MAINTENANCE overall: carry every open alert forward untouched (a
 *   BMC connectivity blip or planned work must neither open nor falsely
 *   recover anything).
 * - Each WARNING/CRITICAL component or predictive failure: raise, or re-ingest
 *   under its existing eventId so the same alert row picks up the latest
 *   severity/summary.
 * - An open alert whose condition is gone: recover it — unless its component
 *   is now UNKNOWN or its kind wasn't read this time, in which case keep it.
 */
export function planComponentAlerts(
  open: OpenComponentAlerts,
  snap: HealthSnapshotDto,
  newEventId: () => string,
): ComponentAlertPlan {
  if (!ALERTABLE.includes(snap.overallHealth) && snap.overallHealth !== "HEALTHY") {
    return { next: { ...open }, raise: [], recover: [] };
  }

  const next: OpenComponentAlerts = {};
  const raise: ComponentAlertRaise[] = [];
  const recover: ComponentAlertRecover[] = [];

  for (const [key, cond] of currentConditions(snap)) {
    const eventId = open[key]?.eventId ?? newEventId();
    const { kind, ...rest } = cond;
    next[key] = { eventId, alertType: cond.alertType, componentKey: cond.componentKey, kind };
    raise.push({ eventId, ...rest });
  }

  const unknownNow = new Set(
    snap.degraded.filter((d) => d.health === "UNKNOWN").map((d) => componentKeyFor(d.kind, d.name)),
  );
  for (const [key, alert] of Object.entries(open)) {
    if (next[key]) {
      continue;
    }
    if (unknownNow.has(alert.componentKey) || !kindObserved(alert.kind, snap)) {
      next[key] = alert;
      continue;
    }
    recover.push({
      eventId: alert.eventId,
      alertType: alert.alertType,
      componentKey: alert.componentKey,
    });
  }

  return { next, raise, recover };
}

/** Defensive read of the `open_alerts` JSON column. */
export function parseOpenAlerts(value: unknown): OpenComponentAlerts {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const out: OpenComponentAlerts = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const e = entry as Partial<OpenComponentAlert> | null;
    if (e && typeof e.eventId === "string" && typeof e.alertType === "string") {
      out[key] = {
        eventId: e.eventId,
        alertType: e.alertType,
        componentKey: typeof e.componentKey === "string" ? e.componentKey : "SYSTEM",
        kind: (e.kind as HealthComponentKind) ?? "SYSTEM",
      };
    }
  }
  return out;
}
