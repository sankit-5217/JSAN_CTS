import { Module } from "@nestjs/common";

/**
 * Owner: Dev A (Platform & Ticketing Core).
 * Owns: append-only audit records (spec §12).
 * Must not own: business entity edits.
 *
 * TODO (Sprint 2): audit_events table + AuditService consumed by every other
 * module for every state change, assignment, SLA pause, worklog, attachment,
 * vendor update and admin change. Every mutation records actor, timestamp,
 * request/correlation ID and a before/after summary (spec §13.1, §17).
 */
@Module({})
export class AuditModule {}
