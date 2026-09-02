# JSAN CTS Data Center OpsDesk

A centralized data-center infrastructure operations and service-management platform: site/asset visibility, CMDB, incidents and requests, SLA governance, engineer worklogs, Dell/HPE hardware lifecycle tracking, monitoring alerts, vendor/RMA coordination, SOPs, risk/BCP records, and management reporting.

This is **not** a ServiceNow clone. We build only the capabilities required for CTS data-center operations and reuse mature monitoring/logging technologies (Zabbix/Prometheus/Grafana, Loki/OpenSearch) instead of rebuilding them.

Full requirements live in `docs/JSAN_CTS_DC_OpsDesk_Developer_Build_Architecture_v1.0.pdf` (the build specification). Read it before writing code — this scaffold implements Sprint 1 (Foundation) from that document's §23 backlog.

## Architecture at a glance

- **Backend**: NestJS modular monolith (`apps/api`) — one deployable service, strict module boundaries (see `docs/adr/ADR-001-modular-monolith.md` and §12 of the spec).
- **Worker**: separate process (`apps/worker`) for SLA timers, alert correlation, notifications, polling — same codebase, BullMQ/Redis backed.
- **Frontend**: React + TypeScript + Vite + MUI (`apps/web`).
- **Database**: PostgreSQL via Prisma (`apps/api/prisma/schema.prisma`). Telemetry/logs stay in monitoring/log platforms, not Postgres.
- **Queue/Cache**: Redis + BullMQ.
- **Object storage**: S3-compatible (MinIO in dev) for attachments/evidence.
- **Integrations**: isolated adapters under `integrations/` (Redfish, Dell OME, Zabbix, Prometheus, SNMP, email) — never called directly from core ticket logic.

See `docs/adr/` for the numbered architecture decisions and `docs/PROJECT_OVERVIEW.md` for the two-developer task split.

## Repository layout

```
cts-dc-opsdesk/
├── apps/
│   ├── web/        # React UI
│   ├── api/        # NestJS HTTP API (modular monolith)
│   └── worker/     # queues, SLA timers, alerts, notifications
├── packages/
│   └── shared-types/   # enums/DTOs shared between api, worker, web
├── integrations/        # external adapters, isolated from core ticket logic
│   ├── redfish/
│   ├── dell-ome/
│   ├── zabbix/
│   ├── prometheus/
│   ├── snmp/
│   └── email/
├── infra/
│   ├── docker/      # Dockerfiles for api/web/worker
│   └── migrations/  # notes on Prisma migration workflow
├── docs/
│   ├── adr/         # Architecture Decision Records
│   ├── PROJECT_OVERVIEW.md
│   └── runbooks/
└── tests/
    ├── integration/
    └── e2e/
```

**Team discipline**: do not create a "utils" folder containing business logic. Put logic inside the owning domain module with tests.

## Getting started (local dev)

```bash
cp .env.example .env
pnpm install

# start infra dependencies only
docker compose up -d postgres redis minio

# run migrations + generate client
pnpm prisma:migrate
pnpm prisma:generate

# run api, worker, web in separate terminals
pnpm dev:api
pnpm dev:worker
pnpm dev:web
```

API health check: `GET http://localhost:3000/api/v1/health`
Swagger/OpenAPI: `http://localhost:3000/api/docs`
Web: `http://localhost:5173`

## Non-negotiable guardrails

1. Authorization is enforced **server-side** on every API call — hiding a UI button is not security.
2. Every state change, assignment, SLA pause, worklog, attachment, vendor update and admin change creates an **append-only audit event**.
3. SLA times, priorities, ownership and calendars are **configurable data**, never hard-coded.
4. Repeated webhooks/polls must be **idempotent** (`external_event_id` + alert fingerprint).
5. Do not expose iDRAC/iLO/SNMP management ports to the public Internet — use the site collector pattern.
6. Do not start with AI, microservices, or vendor automation. Build the MVP in the phase order in §22 of the spec.

## Task division

See `docs/PROJECT_OVERVIEW.md` for the full project explanation and the two-developer track split (Platform & Ticketing Core vs. Integrations, Hardware & Governance).
