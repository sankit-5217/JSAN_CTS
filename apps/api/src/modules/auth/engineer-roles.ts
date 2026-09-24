import { UserRole } from "@prisma/client";

/**
 * Roles that count as engineers: the people who hold skills, work shifts
 * and get tickets routed to them. Infrastructure Leads are included because
 * they take on-call and escalation cover. Admin, service desk and other
 * non-engineering roles are not.
 */
export const ENGINEER_ROLES: readonly UserRole[] = [
  UserRole.SITE_ENGINEER,
  UserRole.INFRASTRUCTURE_LEAD,
];

export function isEngineerRole(role: UserRole): boolean {
  return ENGINEER_ROLES.includes(role);
}
