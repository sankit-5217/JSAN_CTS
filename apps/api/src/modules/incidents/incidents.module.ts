import { Module } from "@nestjs/common";

/**
 * Owner: Dev A (Platform & Ticketing Core).
 * Owns: incident state machine, assignments, comments (spec §12, §15).
 * Must not own: vendor polling.
 *
 * TODO (Sprint 4): incident numbering, validation, status state machine
 * (NEW -> ASSIGNED -> ACKNOWLEDGED -> IN_PROGRESS -> PENDING_* -> RESOLVED
 * -> CLOSED, plus REOPEN/CANCELLED), assignment, comments. State transitions
 * must go through a backend transition service — never let the frontend set
 * incident.status directly (spec §15).
 */
@Module({})
export class IncidentsModule {}
