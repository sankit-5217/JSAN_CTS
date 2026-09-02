# ADR-001: Use a modular monolith for core OpsDesk v1

**Status:** Accepted

## Context

The team is fresher and small (two developers). Microservices add
operational overhead (deployment, service discovery, distributed tracing)
that isn't justified until real scaling boundaries appear.

## Decision

One deployable NestJS application (`apps/api`) organized into strongly
separated domain modules (`src/modules/*`, see `CLAUDE.md` ownership
table). Modules communicate via service interfaces/events, never by
reaching into another module's database logic. Background jobs run as a
separate `apps/worker` process from the same codebase.

## Consequences

- One codebase, one deployment pipeline, one Docker image per process.
- Module boundaries are enforced by code review discipline, not network
  boundaries — violations are cheap to introduce and easy to miss without
  care.
- Splitting into services later is possible because boundaries are already
  explicit at the module level.
