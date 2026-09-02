# ADR-006: Use versioned, configurable SLA policies and support calendars

**Status:** Accepted

## Context
Business hours, emergency handling, and ack/resolve targets differ by
site/service and change over time. Hard-coding P1-P4 timers makes the
system unable to reflect real contractual SLAs and breaks historical
reporting when policy changes.

## Decision
`SlaPolicy` rows are versioned with `effectiveFrom`/`effectiveTo`.
`SupportCalendar` rows define per-site business hours/holidays/24x7 flag.
`SlaInstance` records which policy version applied to a given incident and
stores exact timer events for breach evidence (spec §10.8).

## Consequences
- SLA math must always resolve "which policy version was active at
  incident creation," not just "the current policy."
- Priority overrides require a reason and generate an audit event.
- The `sla` module (Dev A) and worker's `sla-timers` queue must agree on
  policy semantics — keep them in the same module boundary.
