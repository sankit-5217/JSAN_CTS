# CLAUDE.md

Guidance for AI agents (and humans) working in this repository.

## What this repo is

JSAN CTS Data Center OpsDesk — an ITSM + CMDB + monitoring-integration platform for CTS/JSAN data-center operations. Full spec: `docs/JSAN_CTS_DC_OpsDesk_Developer_Build_Architecture_v1.0.pdf`. Read it before implementing any module.

## Non-negotiable rules (from the build spec)

- **Modular monolith first.** One NestJS app (`apps/api`) with strongly separated domain modules under `apps/api/src/modules/*`. Modules must not directly manipulate another module's database logic — cross-module calls go through service interfaces/events. Do not introduce microservices or Kubernetes.
- **Backend owns authorization.** Every API call enforces RBAC + site/customer scope server-side. Never rely on the frontend hiding a button.
- **Audit everything.** Every state change, assignment, SLA pause, worklog, attachment, vendor update and admin change must emit an append-only audit event (see `audit` module).
- **Configuration over hard-code.** SLA times, priorities, support calendars, escalation thresholds and alert rules live in the database, never in code constants.
- **State transitions are backend rules.** Never let the frontend set `incident.status` directly — always go through a transition service that validates role, current state, required fields, SLA effects and emits audit events.
- **Idempotent integrations.** Alert/webhook ingestion must dedupe via `external_event_id` and a stable fingerprint (site + CI + alert type + component).
- **Keep telemetry out of Postgres.** Only normalized alerts, current health state, and references to logs/metrics — not raw time-series or log bodies. Use Zabbix/Prometheus/Grafana and Loki/OpenSearch for that instead of rebuilding them.
- **No destructive hardware actions in v1.** Read/observe/record only for Redfish/iDRAC/iLO. No firmware updates, reboots, or BIOS changes from the portal.
- **Never expose management interfaces to the Internet.** iDRAC/iLO/SNMP stay behind the site collector, which connects outbound over TLS/mTLS only.
- **No "utils" folder with business logic.** Logic lives inside the owning domain module, with tests alongside it.
- **Don't build AI features yet.** Ticket, CMDB and telemetry data must be stable and trustworthy first (see spec §27).

## Module ownership boundaries (spec §12)

Each backend module owns its data and must not own another module's concern:

| Module | Owns | Must not own |
|---|---|---|
| auth | identity mapping, sessions/tokens, roles | incident business rules |
| sites | sites, timezone, contacts, support calendars | hardware telemetry |
| cmdb | CIs, components, relationships, lifecycle | ticket SLA state |
| incidents | incident state machine, assignments, comments | vendor polling |
| sla | policy versions, timers, escalations | UI-only countdowns |
| alerts | normalized alerts, fingerprints, correlation | raw time-series storage |
| worklogs | engineer activity and time corrections | authentication |
| vendors | vendors, warranties, cases, RMA | monitoring metrics |
| knowledge | SOPs/runbooks, approvals, versions | incident creation |
| changes | change workflow and maintenance windows | monitoring storage |
| risks | risk register, BCP records | ticket state |
| reports | read models/aggregations | source-of-truth mutations |
| audit | append-only audit records | business entity edits |

## Definition of done (spec §24)

Every feature/story must have: acceptance criteria demonstrated, backend authorization + input validation, audit events for business-critical mutations, unit/integration tests, no TS/lint errors, reviewed migration with rollback plan, OpenAPI docs, operational logs/metrics for failures, UI error/empty/loading states, no secrets or hard-coded IDs/SLA values, and peer review.

## Commands

```bash
pnpm install
pnpm dev:api       # NestJS API on :3000
pnpm dev:worker    # BullMQ worker
pnpm dev:web       # Vite React app on :5173
pnpm lint
pnpm typecheck
pnpm test
pnpm prisma:migrate
```

## Task division

Two backend/full-stack tracks (see `docs/PROJECT_OVERVIEW.md` for full rationale):
- **Dev A — Platform & Ticketing Core**: auth, sites, cmdb, incidents, worklogs, sla, audit, Command Center.
- **Dev B — Integrations, Hardware & Governance**: alerts, monitoring adapters, hardware (Redfish/Dell/HPE), site collector, vendors, changes, problems, knowledge, risks, worker process.
