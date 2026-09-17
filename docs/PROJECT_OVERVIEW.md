# JSAN Data Center OpsDesk — Project Overview & Task Division

Source of truth: `docs/JSAN_CTS_DC_OpsDesk_Developer_Build_Architecture_v1.0.pdf`. This document summarizes it and assigns ownership between the two developers building it.

## What we're building

A centralized data-center infrastructure operations and service-management platform: site/asset visibility, CMDB, incidents and requests, SLA governance, engineer worklogs, Dell/HPE hardware lifecycle tracking, monitoring alerts, vendor/RMA coordination, SOPs, risk/BCP records, and management reporting. **Not** a ServiceNow clone — build only what JSAN data-center operations need, and reuse mature monitoring/logging tools instead of rebuilding them.

**Operating chain:** Site → Rack → Asset/CI → Health/Alert → Incident → Engineer Action → Vendor Case/RMA → Restoration → RCA → SLA/Management Report.

## Architecture guardrails (non-negotiable)

- **Modular monolith**, not microservices: one NestJS API, strict module boundaries, background jobs as a separate worker process from the same codebase.
- **Stack**: React+TS+Vite+MUI frontend, NestJS+TS backend, PostgreSQL via Prisma, Redis+BullMQ, S3/MinIO for attachments, OIDC/Keycloak for auth.
- **Don't rebuild monitoring/logging** — integrate Zabbix/Prometheus/Grafana and Loki/OpenSearch.
- **Site Collector pattern**: a local agent talks to iDRAC/iLO/SNMP and pushes outbound over TLS; never expose management ports to the internet.
- **CMDB-first, audit-everything, config-over-hardcode**: SLA times, priorities, calendars are DB-driven; every mutation is append-only audited.
- **Backend owns authorization and state transitions** — the frontend never sets `incident.status` directly or hides risk with a disabled button.
- **Build order matters**: Foundation → Operational MVP → SLA/Command Center → Monitoring integration → Hardware (Redfish/Dell/HPE) → Vendor/RMA/Governance → Hardening. No AI, no microservices, no destructive remote hardware actions in v1.

## Repository layout

```
apps/
  api/      NestJS modular monolith (all domain modules under src/modules/*)
  web/      React + Vite + MUI frontend
  worker/   BullMQ background jobs (SLA timers, alert correlation, notifications)
packages/
  shared-types/   enums/DTOs shared across api, worker, web
integrations/
  redfish/, dell-ome/, zabbix/, prometheus/, snmp/, email/
infra/
  docker/   Dockerfiles per app
  migrations/
docs/
  adr/      8 architecture decision records (spec Appendix B)
  runbooks/
tests/
  integration/, e2e/
```

**Current status**: all 16 backend modules (`apps/api/src/modules/*`) are implemented with tests (465+ passing), the frontend covers every module with a working page, and Sprint 12 (Hardening/UAT) work — rate limiting, CI dependency/secret/container scanning, DB and object-storage backup/restore drills (`docs/runbooks/`) — is done. Real SSO/OIDC integration is the one deferred item; `dev-login` (disabled outside dev/local) stands in for it. See `CLAUDE.md` for the guardrails AI/human contributors should follow, and `README.md` for local dev setup.

## Two-developer task split

Rather than split by frontend/backend (every feature needs RBAC + audit + tests on both), split by **domain ownership** — this follows the module-boundary table the spec itself defines (§12), so each developer owns a complete vertical slice (API + UI + tests) with no shared files to conflict over.

### Developer A — Platform & Ticketing Core

The system-of-record backbone. Everything else depends on this being solid first.

| Module      | Responsibility                                                                   |
| ----------- | -------------------------------------------------------------------------------- |
| `auth`      | Identity (OIDC/Keycloak), RBAC, site-scoped permissions                          |
| `sites`     | Site master, contacts, support calendars _(scaffolded as the reference pattern)_ |
| `cmdb`      | Configuration Items, racks, relationships, lifecycle, bulk import                |
| `incidents` | State machine, assignment, comments, transitions                                 |
| `worklogs`  | Engineer clocking, immutable corrections                                         |
| `sla`       | Policy versions, timers, escalation jobs                                         |
| `audit`     | Append-only audit event framework                                                |
| `reports`   | Command Center dashboard, SLA/incident reports                                   |

**Sprint mapping** (spec §23): 1 (shared), 2, 4, 5, 6, 7.

### Developer B — Integrations, Hardware & Governance

Everything that talks to the outside world, plus operational governance.

| Module               | Responsibility                                                            |
| -------------------- | ------------------------------------------------------------------------- |
| `alerts`             | Ingestion endpoint, fingerprinting, dedup, correlation                    |
| Monitoring adapters  | `integrations/zabbix`, `integrations/prometheus`, maintenance suppression |
| Hardware integration | `integrations/redfish` baseline + `integrations/dell-ome`, HPE iLO        |
| Site Collector       | Outbound-TLS agent design (spec §11)                                      |
| `vendors`            | Vendor cases, warranty, RMA lifecycle                                     |
| `changes`            | Change workflow, problem/RCA records                                      |
| `knowledge`          | SOPs, runbooks, approvals                                                 |
| `risks`              | Risk register, BCP                                                        |
| `apps/worker`        | Background jobs: SLA timers, alert correlation, notifications, polling    |

**Sprint mapping**: 1 (shared), 3 (CMDB assist), 8, 9, 10, 11.

### Shared / collaborative

- **Sprint 1 (Foundation)** — done; both devs should read it end-to-end before extending it.
- **Sprint 12 (Hardening/UAT)** — done: rate limiting, CI dependency/secret/container scanning, `SiteScopeGuard` test coverage, and DB + object-storage backup/restore drills (`docs/runbooks/`). Real SSO/OIDC (spec's auth integration) remains open — `dev-login` stands in for it, disabled outside dev/local.
- `cmdb` is a shared dependency: Dev A builds it first since `incidents` needs it (target: stable by end of Sprint 3), but Dev B's hardware/alert work all links back to CIs — sync when the CMDB schema stabilizes.
- Both developers independently satisfy the **Definition of Done** (spec §24) on every story: backend authorization, audit events, tests, no hardcoded values, OpenAPI docs, UI error/empty/loading states, peer review. This isn't divisible — it's the bar both clear on every PR.

## Suggested first milestone

Follow the **Recommended First Development Demo** (spec §31) as the integration checkpoint after Sprints 1–4: admin creates a site/rack/CIs → service desk creates an incident → SLA starts → engineer acknowledges and clocks time → a simulated alert lands on the same incident timeline → a vendor case/RMA is recorded → recovery is observed → incident resolves → manager sees updated dashboards → auditor reconstructs the full timeline. If this vertical slice works, the core architecture (identity → CMDB → ticket → SLA → worklog → telemetry → vendor → audit → reporting) is proven.

## Reference implementation

The `sites` module (`apps/api/src/modules/sites/`) was the original pattern to copy — Prisma-backed service, controller, validated DTO — and the `SitesPage` in `apps/web/src/pages/` the matching frontend pattern (fetch from API, typed response, MUI table). Every other module now follows the same shape: `alerts`, `audit`, `auth`, `changes`, `cmdb`, `health`, `incidents`, `knowledge`, `monitoring`, `problems`, `reports`, `risks`, `sla`, `vendors`, `worklogs` are all implemented, not stubbed — each with its own `*.service.spec.ts` (and e2e coverage in `apps/api/test/` for the ones that need it) rather than a `TODO` comment.
