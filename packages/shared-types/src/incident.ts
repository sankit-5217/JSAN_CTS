/**
 * Mirrors the Prisma enums in apps/api/prisma/schema.prisma. Keep these two
 * definitions in sync manually until a codegen step is introduced — do not
 * let the frontend invent its own status strings (spec §15: state
 * transitions are backend rules).
 */
export enum IncidentStatus {
  NEW = "NEW",
  ASSIGNED = "ASSIGNED",
  ACKNOWLEDGED = "ACKNOWLEDGED",
  IN_PROGRESS = "IN_PROGRESS",
  PENDING_VENDOR = "PENDING_VENDOR",
  PENDING_CUSTOMER = "PENDING_CUSTOMER",
  RESOLVED = "RESOLVED",
  CLOSED = "CLOSED",
  REOPENED = "REOPENED",
  CANCELLED = "CANCELLED",
}

export enum Priority {
  P1 = "P1",
  P2 = "P2",
  P3 = "P3",
  P4 = "P4",
}
