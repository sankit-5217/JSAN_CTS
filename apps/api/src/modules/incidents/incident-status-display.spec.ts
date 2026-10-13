import { IncidentStatus, UserRole } from "@prisma/client";
import { fieldsForPath, planTemplateStatus, TEMPLATE_STATUS_FOR } from "./incident-status-display";
import { TransitionRule } from "./incident-transitions";

const asRole =
  (role: UserRole, owner = true) =>
  (rule: TransitionRule) =>
    rule.allowedRoles.includes(role) && (!rule.requiresOwnerOrElevated || owner);

const tos = (path: TransitionRule[] | null) => path?.map((r) => r.to) ?? null;

describe("incident template status", () => {
  it("shows every backend status as a template label (cancelled excepted)", () => {
    for (const status of Object.values(IncidentStatus)) {
      expect(TEMPLATE_STATUS_FOR[status] === null).toBe(status === IncidentStatus.CANCELLED);
    }
  });

  it("acknowledging is enough for In Progress", () => {
    expect(
      tos(
        planTemplateStatus(IncidentStatus.ASSIGNED, "IN_PROGRESS", asRole(UserRole.SITE_ENGINEER)),
      ),
    ).toEqual([IncidentStatus.ACKNOWLEDGED]);
  });

  it("reopens then resumes for In Progress on a fixed ticket", () => {
    expect(
      tos(
        planTemplateStatus(IncidentStatus.RESOLVED, "IN_PROGRESS", asRole(UserRole.SITE_ENGINEER)),
      ),
    ).toEqual([IncidentStatus.REOPENED, IncidentStatus.IN_PROGRESS]);
  });

  it("maps Pending 3rd Party, Assigned to requester and Fixed onto the existing states", () => {
    const eng = asRole(UserRole.SITE_ENGINEER);
    expect(tos(planTemplateStatus(IncidentStatus.IN_PROGRESS, "PENDING_3RD_PARTY", eng))).toEqual([
      IncidentStatus.PENDING_VENDOR,
    ]);
    expect(
      tos(planTemplateStatus(IncidentStatus.IN_PROGRESS, "ASSIGNED_TO_REQUESTER", eng)),
    ).toEqual([IncidentStatus.PENDING_CUSTOMER]);
    expect(tos(planTemplateStatus(IncidentStatus.IN_PROGRESS, "FIXED", eng))).toEqual([
      IncidentStatus.RESOLVED,
    ]);
  });

  it("returns null for the current label and for moves the role can't make", () => {
    expect(
      planTemplateStatus(
        IncidentStatus.ACKNOWLEDGED,
        "IN_PROGRESS",
        asRole(UserRole.SITE_ENGINEER),
      ),
    ).toBeNull();
    // Service desk can't acknowledge, so it can't take an assigned ticket to In Progress.
    expect(
      planTemplateStatus(IncidentStatus.ASSIGNED, "IN_PROGRESS", asRole(UserRole.SERVICE_DESK_NOC)),
    ).toBeNull();
    // A non-owner engineer can't resolve.
    expect(
      planTemplateStatus(
        IncidentStatus.IN_PROGRESS,
        "FIXED",
        asRole(UserRole.SITE_ENGINEER, false),
      ),
    ).toBeNull();
  });

  it("asks for the other ticket on Blocked by / Duplicate of", () => {
    const path = planTemplateStatus(
      IncidentStatus.NEW,
      "DUPLICATE_OF",
      asRole(UserRole.SERVICE_DESK_NOC),
    );
    expect(tos(path)).toEqual([IncidentStatus.DUPLICATE]);
    expect(fieldsForPath(path!)).toEqual(["refIncidentNo"]);
    const blocked = planTemplateStatus(
      IncidentStatus.IN_PROGRESS,
      "BLOCKED_BY",
      asRole(UserRole.SERVICE_DESK_NOC),
    );
    expect(tos(blocked)).toEqual([IncidentStatus.BLOCKED]);
  });

  it("collects required fields across a chain", () => {
    const path = planTemplateStatus(
      IncidentStatus.RESOLVED,
      "IN_PROGRESS",
      asRole(UserRole.SITE_ENGINEER),
    );
    expect(fieldsForPath(path!)).toEqual(["reason"]);
  });
});
