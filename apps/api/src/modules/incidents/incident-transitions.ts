import { Incident, IncidentStatus, UserRole } from "@prisma/client";

/**
 * Encodes spec §15's state-transition table as data, not scattered `if`
 * statements. Transcribed directly from
 * docs/JSAN_CTS_DC_OpsDesk_Developer_Build_Architecture_v1.0.pdf §15
 * (extracted via `pdftotext -raw` — the default layout-mode extraction
 * garbled this specific table's columns).
 *
 * This table is a fixed business state machine, not a runtime-configurable
 * value like SLA minutes or escalation thresholds — the spec's own opening
 * guideline says to "use the data model and state machines exactly as the
 * baseline unless an architecture decision is approved," so unlike SLA
 * policy this is kept in code (same precedent as CI_RELATION_TYPES in the
 * cmdb module).
 */
export interface TransitionDto {
  toStatus: IncidentStatus;
  reason?: string;
  ownerGroupId?: string;
  ownerUserId?: string;
  resolutionCategory?: string;
  rootCauseSummary?: string;
}

export interface TransitionRule {
  from: IncidentStatus[];
  to: IncidentStatus;
  allowedRoles: UserRole[];
  /** Caller must be the incident's assigned owner OR hold an elevated role. */
  requiresOwnerOrElevated?: boolean;
  requiredFields?: (keyof TransitionDto)[];
  /** For validations that aren't a simple "field present" check. */
  validate?: (incident: Incident, dto: TransitionDto) => string | undefined;
}

export const ELEVATED_ROLES: readonly UserRole[] = [
  UserRole.SUPER_ADMIN,
  UserRole.INFRASTRUCTURE_LEAD,
  UserRole.DELIVERY_OPS_MANAGER,
];

const OPEN_STATUSES: IncidentStatus[] = [
  IncidentStatus.NEW,
  IncidentStatus.ASSIGNED,
  IncidentStatus.ACKNOWLEDGED,
  IncidentStatus.IN_PROGRESS,
  IncidentStatus.PENDING_VENDOR,
  IncidentStatus.PENDING_CUSTOMER,
  IncidentStatus.REOPENED,
];

export function isOwnerOrElevated(userId: string, userRole: UserRole, incident: Incident): boolean {
  return incident.ownerUserId === userId || ELEVATED_ROLES.includes(userRole);
}

export const TRANSITION_RULES: TransitionRule[] = [
  {
    from: [IncidentStatus.NEW],
    to: IncidentStatus.ASSIGNED,
    allowedRoles: [UserRole.SERVICE_DESK_NOC, UserRole.INFRASTRUCTURE_LEAD, UserRole.SUPER_ADMIN],
    validate: (incident, dto) => {
      const ownerGroupId = dto.ownerGroupId ?? incident.ownerGroupId;
      const ownerUserId = dto.ownerUserId ?? incident.ownerUserId;
      if (!ownerGroupId && !ownerUserId) {
        return "ownerGroupId or ownerUserId must be resolved (already set, or provided in this request) before assigning";
      }
      return undefined;
    },
  },
  {
    from: [IncidentStatus.ASSIGNED],
    to: IncidentStatus.ACKNOWLEDGED,
    allowedRoles: [UserRole.SITE_ENGINEER, UserRole.INFRASTRUCTURE_LEAD, UserRole.SUPER_ADMIN],
    requiresOwnerOrElevated: true,
  },
  {
    from: [IncidentStatus.ACKNOWLEDGED],
    to: IncidentStatus.IN_PROGRESS,
    allowedRoles: [UserRole.SITE_ENGINEER, UserRole.INFRASTRUCTURE_LEAD, UserRole.SUPER_ADMIN],
    requiresOwnerOrElevated: true,
  },
  {
    // Full "vendor case required" enforcement deferred until the vendors
    // module exists (Dev B, Sprint 11) — v1 requires a reason instead.
    from: [IncidentStatus.IN_PROGRESS],
    to: IncidentStatus.PENDING_VENDOR,
    allowedRoles: [UserRole.SITE_ENGINEER, UserRole.INFRASTRUCTURE_LEAD, UserRole.SUPER_ADMIN],
    requiresOwnerOrElevated: true,
    requiredFields: ["reason"],
  },
  {
    from: [IncidentStatus.IN_PROGRESS],
    to: IncidentStatus.PENDING_CUSTOMER,
    allowedRoles: [
      UserRole.SERVICE_DESK_NOC,
      UserRole.SITE_ENGINEER,
      UserRole.INFRASTRUCTURE_LEAD,
      UserRole.SUPER_ADMIN,
    ],
    requiredFields: ["reason"],
  },
  {
    from: [IncidentStatus.PENDING_VENDOR, IncidentStatus.PENDING_CUSTOMER],
    to: IncidentStatus.IN_PROGRESS,
    allowedRoles: [
      UserRole.SITE_ENGINEER,
      UserRole.SERVICE_DESK_NOC,
      UserRole.INFRASTRUCTURE_LEAD,
      UserRole.SUPER_ADMIN,
    ],
    requiresOwnerOrElevated: true,
  },
  {
    // CI health-check validation deferred (alerts/health module, Dev B).
    from: [IncidentStatus.IN_PROGRESS],
    to: IncidentStatus.RESOLVED,
    allowedRoles: [UserRole.SITE_ENGINEER, UserRole.INFRASTRUCTURE_LEAD, UserRole.SUPER_ADMIN],
    requiresOwnerOrElevated: true,
    requiredFields: ["resolutionCategory", "rootCauseSummary"],
  },
  {
    from: [IncidentStatus.RESOLVED],
    to: IncidentStatus.CLOSED,
    allowedRoles: [UserRole.SERVICE_DESK_NOC, UserRole.INFRASTRUCTURE_LEAD, UserRole.SUPER_ADMIN],
  },
  {
    from: [IncidentStatus.RESOLVED],
    to: IncidentStatus.REOPENED,
    allowedRoles: [
      UserRole.SERVICE_DESK_NOC,
      UserRole.SITE_ENGINEER,
      UserRole.INFRASTRUCTURE_LEAD,
      UserRole.SUPER_ADMIN,
    ],
    requiredFields: ["reason"],
  },
  {
    // v1 assumption: spec doesn't say what follows REOPENED explicitly —
    // treated like any other open state re-entering the active pipeline.
    from: [IncidentStatus.REOPENED],
    to: IncidentStatus.IN_PROGRESS,
    allowedRoles: [UserRole.SITE_ENGINEER, UserRole.INFRASTRUCTURE_LEAD, UserRole.SUPER_ADMIN],
    requiresOwnerOrElevated: true,
  },
  {
    from: OPEN_STATUSES,
    to: IncidentStatus.CANCELLED,
    allowedRoles: [UserRole.INFRASTRUCTURE_LEAD, UserRole.SUPER_ADMIN],
    requiredFields: ["reason"],
  },
];

export function findTransitionRule(
  from: IncidentStatus,
  to: IncidentStatus,
): TransitionRule | undefined {
  return TRANSITION_RULES.find((rule) => rule.from.includes(from) && rule.to === to);
}
