# ADR-002: Use PostgreSQL as the operational system of record

**Status:** Accepted

## Context

CMDB relationships, incident state, SLA timers, ownership and reporting
all depend on relational integrity and transactional consistency.

## Decision

PostgreSQL via Prisma (`apps/api/prisma/schema.prisma`) is the system of
record for all ITSM/CMDB/operational data. UUID primary keys internally,
separate human-readable codes for the UI. Foreign keys for core
relationships — no burying important IDs inside JSON blobs.

## Consequences

- Strong consistency for incidents, CMDB, SLA and audit data.
- JSONB reserved for vendor-specific/extensible metadata only (e.g.
  `ConfigurationItem.metadata`).
- Migrations are the only path to schema change — no manual production DDL.
