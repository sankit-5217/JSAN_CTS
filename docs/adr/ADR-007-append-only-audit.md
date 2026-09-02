# ADR-007: Use append-only incident/audit events for operational traceability

**Status:** Accepted

## Context
Disputes, compliance and RCA all require reconstructing exactly what
happened, by whom, and when — not just the current state of a record.

## Decision
`IncidentEvent` and `AuditEvent` are append-only tables (`IncidentEvent`
per incident timeline, `AuditEvent` platform-wide). Every state change,
assignment, SLA pause, worklog correction, attachment, vendor update and
admin change writes a row with actor, timestamp, correlation ID and a
before/after summary. Records are never hard-deleted — master records are
retired/cancelled instead (spec §13.1, §17).

## Consequences
- Every module that mutates state has an implicit dependency on the
  `audit` module (Dev A) — build/stabilize it early (Sprint 2).
- Storage grows monotonically; retention policy is a separate, deliberate
  decision per data class (spec §18), not an excuse to delete audit rows.
