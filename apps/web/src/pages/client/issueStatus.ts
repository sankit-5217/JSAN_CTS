import type { IncidentStatus } from "@cts-dc-opsdesk/shared-types";

/**
 * The issue template's Status list, as every portal shows it. A view over
 * the backend state machine — the mapping mirrors
 * apps/api/src/modules/incidents/incident-status-display.ts, which also
 * decides what a pick actually does (POST /incidents/:id/status).
 */
export type TemplateStatus =
  | "NEW"
  | "ASSIGNED"
  | "IN_PROGRESS"
  | "PENDING_3RD_PARTY"
  | "ASSIGNED_TO_REQUESTER"
  | "FIXED"
  | "BLOCKED_BY"
  | "DUPLICATE_OF";

export const TEMPLATE_STATUS_LABEL: Record<TemplateStatus, string> = {
  NEW: "New",
  ASSIGNED: "Assigned",
  IN_PROGRESS: "In Progress",
  PENDING_3RD_PARTY: "Pending 3rd Party",
  ASSIGNED_TO_REQUESTER: "Assigned to requester",
  FIXED: "Fixed",
  BLOCKED_BY: "Blocked by",
  DUPLICATE_OF: "Duplicate of",
};

const TEMPLATE_STATUS_FOR: Record<IncidentStatus, TemplateStatus | null> = {
  NEW: "NEW",
  ASSIGNED: "ASSIGNED",
  REOPENED: "ASSIGNED",
  ACKNOWLEDGED: "IN_PROGRESS",
  IN_PROGRESS: "IN_PROGRESS",
  PENDING_VENDOR: "PENDING_3RD_PARTY",
  PENDING_CUSTOMER: "ASSIGNED_TO_REQUESTER",
  RESOLVED: "FIXED",
  CLOSED: "FIXED",
  BLOCKED: "BLOCKED_BY",
  DUPLICATE: "DUPLICATE_OF",
  CANCELLED: null,
};

/** "Blocked by INC-000123", "Fixed", "Cancelled". */
export function templateStatusText(status: IncidentStatus, refIncidentNo?: string | null): string {
  const template = TEMPLATE_STATUS_FOR[status];
  if (!template) return "Cancelled";
  const label = TEMPLATE_STATUS_LABEL[template];
  return (template === "BLOCKED_BY" || template === "DUPLICATE_OF") && refIncidentNo
    ? `${label} ${refIncidentNo}`
    : label;
}

/** GET /incidents/:id/status-options (IncidentsService.getTemplateStatusOptions). */
export interface TemplateStatusOption {
  status: TemplateStatus;
  label: string;
  current: boolean;
  available: boolean;
  steps: IncidentStatus[];
  fields: ("reason" | "resolutionCategory" | "rootCauseSummary" | "refIncidentNo")[];
  hint?: string;
}
