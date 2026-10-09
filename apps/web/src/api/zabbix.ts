import { ApiError } from "./client";

// Mirrors ZABBIX_*_ROLES in apps/api/src/modules/monitoring/zabbix/zabbix.controller.ts.
// UI-only show/hide; the API re-checks every request.
export const ZABBIX_ADMIN_ROLES = ["SUPER_ADMIN", "DELIVERY_OPS_MANAGER"];
export const ZABBIX_VIEW_ROLES = [
  "SUPER_ADMIN",
  "DELIVERY_OPS_MANAGER",
  "SERVICE_DESK_NOC",
  "SITE_ENGINEER",
  "INFRASTRUCTURE_LEAD",
  "VENDOR_COORDINATOR",
  "AUDITOR_READ_ONLY",
];
export const ZABBIX_ACK_ROLES = [
  "SUPER_ADMIN",
  "DELIVERY_OPS_MANAGER",
  "SERVICE_DESK_NOC",
  "SITE_ENGINEER",
  "INFRASTRUCTURE_LEAD",
];

export const ZABBIX_BASE = "/monitoring/zabbix";
export const REFRESH_MS = 30_000;

export type Availability = "UP" | "DOWN" | "UNKNOWN";

export interface ZabbixHost {
  hostId: string;
  host: string;
  name: string;
  enabled: boolean;
  inMaintenance: boolean;
  availability: Availability;
  siteCode: string | null;
  ciCode: string | null;
  ciId: string | null;
  groups: string[];
  tags: { tag: string; value: string }[];
  interfaces: {
    type: string;
    address: string;
    port: string;
    availability: Availability;
    error: string | null;
  }[];
  problemCount?: number;
  maxSeverity?: number | null;
}

export interface ZabbixProblem {
  eventId: string;
  name: string;
  severity: number;
  severityLabel: string;
  startedAt: string;
  ageSeconds: number;
  acknowledged: boolean;
  suppressed: boolean;
  operationalData: string | null;
  tags: { tag: string; value: string }[];
  host: ZabbixHost | null;
  acknowledges: { at: string; message: string; by: string | null }[];
}

export interface ZabbixItem {
  itemId: string;
  name: string;
  key: string;
  lastValue: string | null;
  previousValue: string | null;
  lastSeenAt: string | null;
  units: string;
  numeric: boolean;
  supported: boolean;
  error: string | null;
}

export interface ZabbixHistory {
  itemId: string;
  name: string;
  units: string;
  numeric: boolean;
  from: number;
  to: number;
  source: "history" | "trends";
  points: { t: number; v: number; min?: number; max?: number }[];
  values?: { t: number; value: string }[];
}

export interface ZabbixList<T> {
  webUrl: string;
  items: T[];
}

/** MUI chip colour per Zabbix severity (0..5). Always shown with its label. */
export function severityColor(severity: number): "default" | "info" | "warning" | "error" {
  if (severity >= 4) return "error";
  if (severity >= 2) return "warning";
  if (severity === 1) return "info";
  return "default";
}

export const AVAILABILITY_COLOR: Record<Availability, "success" | "error" | "default"> = {
  UP: "success",
  DOWN: "error",
  UNKNOWN: "default",
};

export function formatAge(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

/** Human value with Zabbix units: bytes scale to KB/MB/GB, "s" to a duration. */
export function formatValue(raw: string | number | null, units: string): string {
  if (raw === null || raw === "") return "—";
  const n = typeof raw === "number" ? raw : Number(raw);
  if (Number.isNaN(n)) return String(raw);
  if (units === "B" || units === "Bps") {
    const steps = ["", "K", "M", "G", "T", "P"];
    let v = Math.abs(n);
    let i = 0;
    while (v >= 1024 && i < steps.length - 1) {
      v /= 1024;
      i += 1;
    }
    return `${(Math.sign(n) * v).toFixed(v < 10 && i > 0 ? 2 : 1)} ${steps[i]}${units}`;
  }
  if (units === "s" || units === "uptime") return formatAge(Math.round(n));
  if (units === "unixtime") return new Date(n * 1000).toLocaleString();
  const rounded = Number.isInteger(n) ? n.toString() : n.toFixed(Math.abs(n) < 10 ? 2 : 1);
  return units ? `${rounded} ${units}` : rounded;
}

/** The API's 503 codes become a sentence the page can show. */
export function zabbixErrorMessage(err: unknown): { code: string | null; message: string } {
  if (err instanceof ApiError) {
    const body = err.body as { code?: string; message?: string | string[] } | null;
    const message = Array.isArray(body?.message) ? body?.message.join(", ") : body?.message;
    return { code: body?.code ?? null, message: message ?? err.message };
  }
  return { code: null, message: (err as Error)?.message ?? "Unknown error" };
}
