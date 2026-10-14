-- Collector heartbeats move out of the audit trail into a one-row-per-site
-- "last seen" table (telemetry is current state, not an audit event).
-- Existing COLLECTOR_HEARTBEAT audit rows are left in place (the audit log
-- is append-only); the latest one per site seeds the new table.
--
-- Rollback:
--   DROP TABLE "collector_heartbeats";
--   (and redeploy the previous API build, which writes heartbeats to audit_events)

-- CreateTable
CREATE TABLE "collector_heartbeats" (
    "site_code" TEXT NOT NULL,
    "last_seen_at" TIMESTAMP(3) NOT NULL,
    "reported_by_id" TEXT,

    CONSTRAINT "collector_heartbeats_pkey" PRIMARY KEY ("site_code")
);

-- Data: last heartbeat per site from the audit trail.
INSERT INTO "collector_heartbeats" ("site_code", "last_seen_at", "reported_by_id")
SELECT DISTINCT ON ("entity_id") "entity_id", "created_at", "actor_id"
FROM "audit_events"
WHERE "entity_type" = 'collector' AND "action" = 'COLLECTOR_HEARTBEAT'
ORDER BY "entity_id", "created_at" DESC
ON CONFLICT ("site_code") DO NOTHING;
