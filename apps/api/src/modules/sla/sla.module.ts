import { Module } from "@nestjs/common";

/**
 * Owner: Dev A (Platform & Ticketing Core).
 * Owns: SLA policy versions, timers, escalations (spec §10.8, §12).
 * Must not own: UI-only countdowns.
 *
 * TODO (Sprint 6): versioned sla_policies, support_calendars, ack/resolve
 * timers driven by the worker process, escalation thresholds (50/75/90/breach).
 * Never hard-code P1-P4 time values — read from configurable policy tables.
 */
@Module({})
export class SlaModule {}
