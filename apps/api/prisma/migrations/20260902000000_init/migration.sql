-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('SUPER_ADMIN', 'SERVICE_DESK_NOC', 'SITE_ENGINEER', 'INFRASTRUCTURE_LEAD', 'VENDOR_COORDINATOR', 'DELIVERY_OPS_MANAGER', 'CTS_MANAGER_VIEWER', 'AUDITOR_READ_ONLY');

-- CreateEnum
CREATE TYPE "ManagedBy" AS ENUM ('JSAN', 'CTS', 'SHARED', 'VENDOR');

-- CreateEnum
CREATE TYPE "Criticality" AS ENUM ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "CiType" AS ENUM ('SERVER', 'FIREWALL', 'SWITCH', 'UPS', 'PDU', 'STORAGE', 'SERVICE', 'CIRCUIT', 'VM');

-- CreateEnum
CREATE TYPE "LifecycleStatus" AS ENUM ('PLANNED', 'ACTIVE', 'MAINTENANCE', 'RETIRED');

-- CreateEnum
CREATE TYPE "IncidentStatus" AS ENUM ('NEW', 'ASSIGNED', 'ACKNOWLEDGED', 'IN_PROGRESS', 'PENDING_VENDOR', 'PENDING_CUSTOMER', 'RESOLVED', 'CLOSED', 'REOPENED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('P1', 'P2', 'P3', 'P4');

-- CreateEnum
CREATE TYPE "AlertSeverity" AS ENUM ('CRITICAL', 'HIGH', 'WARNING', 'INFO');

-- CreateEnum
CREATE TYPE "AlertState" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RECOVERED');

-- CreateEnum
CREATE TYPE "WorklogActivityType" AS ENUM ('REMOTE_WORK', 'ONSITE', 'TRAVEL', 'VENDOR_CALL', 'TESTING', 'WAITING', 'OTHER');

-- CreateEnum
CREATE TYPE "WarrantyStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "DispatchStatus" AS ENUM ('REQUESTED', 'APPROVED', 'SHIPPED', 'DELIVERED', 'INSTALLED', 'RETURNED');

-- CreateEnum
CREATE TYPE "ChangeType" AS ENUM ('STANDARD', 'NORMAL', 'EMERGENCY');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "idp_subject" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sites" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "is_24x7" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_contacts" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "is_on_call" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "site_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_calendars" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "business_start" TEXT NOT NULL,
    "business_end" TEXT NOT NULL,
    "workdays" INTEGER[],
    "holidays" TIMESTAMP(3)[],
    "is_24x7" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "support_calendars_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_groups" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "configuration_items" (
    "id" TEXT NOT NULL,
    "ci_code" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "ci_type" "CiType" NOT NULL,
    "name" TEXT NOT NULL,
    "manufacturer" TEXT,
    "model" TEXT,
    "serial_or_service_tag" TEXT,
    "management_address" TEXT,
    "owner_group_id" TEXT,
    "managed_by" "ManagedBy" NOT NULL,
    "criticality" "Criticality" NOT NULL,
    "lifecycle_status" "LifecycleStatus" NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "configuration_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ci_relations" (
    "id" TEXT NOT NULL,
    "parent_ci_id" TEXT NOT NULL,
    "child_ci_id" TEXT NOT NULL,
    "relation_type" TEXT NOT NULL,

    CONSTRAINT "ci_relations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "health_snapshots" (
    "id" TEXT NOT NULL,
    "ci_id" TEXT NOT NULL,
    "overall_health" TEXT NOT NULL,
    "details" JSONB,
    "last_heartbeat_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "health_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warranties" (
    "id" TEXT NOT NULL,
    "ci_id" TEXT NOT NULL,
    "status" "WarrantyStatus" NOT NULL,
    "provider" TEXT,
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "warranties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incidents" (
    "id" TEXT NOT NULL,
    "incident_no" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "ci_id" TEXT,
    "status" "IncidentStatus" NOT NULL DEFAULT 'NEW',
    "priority" "Priority" NOT NULL,
    "category" TEXT NOT NULL,
    "impact" TEXT NOT NULL,
    "urgency" TEXT NOT NULL,
    "short_description" TEXT NOT NULL,
    "owner_group_id" TEXT,
    "owner_user_id" TEXT,
    "resolution_category" TEXT,
    "root_cause_summary" TEXT,
    "restored_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incident_events" (
    "id" TEXT NOT NULL,
    "incident_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "actor_id" TEXT,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "incident_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incident_comments" (
    "id" TEXT NOT NULL,
    "incident_id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "is_internal" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "incident_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "worklogs" (
    "id" TEXT NOT NULL,
    "incident_id" TEXT NOT NULL,
    "engineer_id" TEXT NOT NULL,
    "activity_type" "WorklogActivityType" NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL,
    "ended_at" TIMESTAMP(3),
    "duration_minutes" INTEGER,
    "billable_or_contract_flag" BOOLEAN,
    "notes" TEXT,
    "edit_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "worklogs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sla_policies" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priority" "Priority" NOT NULL,
    "ack_target_minutes" INTEGER NOT NULL,
    "resolve_target_minutes" INTEGER NOT NULL,
    "effective_from" TIMESTAMP(3) NOT NULL,
    "effective_to" TIMESTAMP(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "sla_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sla_instances" (
    "id" TEXT NOT NULL,
    "incident_id" TEXT NOT NULL,
    "sla_policy_id" TEXT NOT NULL,
    "ack_due_at" TIMESTAMP(3),
    "acked_at" TIMESTAMP(3),
    "resolve_due_at" TIMESTAMP(3),
    "resolved_at" TIMESTAMP(3),
    "paused_minutes" INTEGER NOT NULL DEFAULT 0,
    "breached" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "sla_instances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alerts" (
    "id" TEXT NOT NULL,
    "external_event_id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "site_id" TEXT,
    "ci_id" TEXT,
    "alert_type" TEXT NOT NULL,
    "severity" "AlertSeverity" NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "first_seen_at" TIMESTAMP(3) NOT NULL,
    "last_seen_at" TIMESTAMP(3) NOT NULL,
    "state" "AlertState" NOT NULL DEFAULT 'OPEN',
    "raw_reference" TEXT,

    CONSTRAINT "alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendors" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vendors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_cases" (
    "id" TEXT NOT NULL,
    "vendor_case_no" TEXT NOT NULL,
    "vendor_id" TEXT NOT NULL,
    "linked_incident_id" TEXT,
    "ci_id" TEXT,
    "warranty_status" "WarrantyStatus" NOT NULL DEFAULT 'UNKNOWN',
    "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledged_at" TIMESTAMP(3),
    "rma_required" BOOLEAN NOT NULL DEFAULT false,
    "replacement_part" TEXT,
    "dispatch_status" "DispatchStatus",
    "vendor_eta" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "outcome" TEXT,

    CONSTRAINT "vendor_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_case_updates" (
    "id" TEXT NOT NULL,
    "vendor_case_id" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vendor_case_updates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "changes" (
    "id" TEXT NOT NULL,
    "change_type" "ChangeType" NOT NULL,
    "reason" TEXT NOT NULL,
    "implementation_plan" TEXT NOT NULL,
    "rollback_plan" TEXT NOT NULL,
    "risk" TEXT NOT NULL,
    "window_start" TIMESTAMP(3) NOT NULL,
    "window_end" TIMESTAMP(3) NOT NULL,
    "approver_id" TEXT,
    "outcome" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_articles" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "owner_id" TEXT,
    "approval_state" TEXT NOT NULL DEFAULT 'DRAFT',
    "review_due_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "knowledge_articles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "risks" (
    "id" TEXT NOT NULL,
    "site_id" TEXT,
    "description" TEXT NOT NULL,
    "likelihood" INTEGER NOT NULL,
    "impact" INTEGER NOT NULL,
    "score" INTEGER NOT NULL,
    "mitigation" TEXT,
    "owner_id" TEXT,
    "due_date" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "risks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" TEXT NOT NULL,
    "actor_id" TEXT,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "correlation_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attachments" (
    "id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "object_key" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "uploaded_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_idp_subject_key" ON "users"("idp_subject");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "sites_code_key" ON "sites"("code");

-- CreateIndex
CREATE INDEX "site_contacts_site_id_idx" ON "site_contacts"("site_id");

-- CreateIndex
CREATE INDEX "support_calendars_site_id_idx" ON "support_calendars"("site_id");

-- CreateIndex
CREATE UNIQUE INDEX "support_groups_name_key" ON "support_groups"("name");

-- CreateIndex
CREATE UNIQUE INDEX "configuration_items_ci_code_key" ON "configuration_items"("ci_code");

-- CreateIndex
CREATE INDEX "configuration_items_site_id_idx" ON "configuration_items"("site_id");

-- CreateIndex
CREATE UNIQUE INDEX "ci_relations_parent_ci_id_child_ci_id_relation_type_key" ON "ci_relations"("parent_ci_id", "child_ci_id", "relation_type");

-- CreateIndex
CREATE UNIQUE INDEX "health_snapshots_ci_id_key" ON "health_snapshots"("ci_id");

-- CreateIndex
CREATE INDEX "warranties_ci_id_idx" ON "warranties"("ci_id");

-- CreateIndex
CREATE UNIQUE INDEX "incidents_incident_no_key" ON "incidents"("incident_no");

-- CreateIndex
CREATE INDEX "incidents_site_id_idx" ON "incidents"("site_id");

-- CreateIndex
CREATE INDEX "incidents_status_idx" ON "incidents"("status");

-- CreateIndex
CREATE INDEX "incident_events_incident_id_idx" ON "incident_events"("incident_id");

-- CreateIndex
CREATE INDEX "incident_comments_incident_id_idx" ON "incident_comments"("incident_id");

-- CreateIndex
CREATE INDEX "worklogs_incident_id_idx" ON "worklogs"("incident_id");

-- CreateIndex
CREATE INDEX "sla_instances_incident_id_idx" ON "sla_instances"("incident_id");

-- CreateIndex
CREATE INDEX "alerts_fingerprint_idx" ON "alerts"("fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "alerts_source_external_event_id_key" ON "alerts"("source", "external_event_id");

-- CreateIndex
CREATE UNIQUE INDEX "vendors_name_key" ON "vendors"("name");

-- CreateIndex
CREATE INDEX "vendor_cases_linked_incident_id_idx" ON "vendor_cases"("linked_incident_id");

-- CreateIndex
CREATE INDEX "audit_events_entity_type_entity_id_idx" ON "audit_events"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "attachments_entity_type_entity_id_idx" ON "attachments"("entity_type", "entity_id");

-- AddForeignKey
ALTER TABLE "site_contacts" ADD CONSTRAINT "site_contacts_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_calendars" ADD CONSTRAINT "support_calendars_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "configuration_items" ADD CONSTRAINT "configuration_items_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ci_relations" ADD CONSTRAINT "ci_relations_parent_ci_id_fkey" FOREIGN KEY ("parent_ci_id") REFERENCES "configuration_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ci_relations" ADD CONSTRAINT "ci_relations_child_ci_id_fkey" FOREIGN KEY ("child_ci_id") REFERENCES "configuration_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "health_snapshots" ADD CONSTRAINT "health_snapshots_ci_id_fkey" FOREIGN KEY ("ci_id") REFERENCES "configuration_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warranties" ADD CONSTRAINT "warranties_ci_id_fkey" FOREIGN KEY ("ci_id") REFERENCES "configuration_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_ci_id_fkey" FOREIGN KEY ("ci_id") REFERENCES "configuration_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incident_events" ADD CONSTRAINT "incident_events_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "incidents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incident_comments" ADD CONSTRAINT "incident_comments_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "incidents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "worklogs" ADD CONSTRAINT "worklogs_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "incidents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "worklogs" ADD CONSTRAINT "worklogs_engineer_id_fkey" FOREIGN KEY ("engineer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sla_instances" ADD CONSTRAINT "sla_instances_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "incidents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sla_instances" ADD CONSTRAINT "sla_instances_sla_policy_id_fkey" FOREIGN KEY ("sla_policy_id") REFERENCES "sla_policies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_ci_id_fkey" FOREIGN KEY ("ci_id") REFERENCES "configuration_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_cases" ADD CONSTRAINT "vendor_cases_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_cases" ADD CONSTRAINT "vendor_cases_linked_incident_id_fkey" FOREIGN KEY ("linked_incident_id") REFERENCES "incidents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_cases" ADD CONSTRAINT "vendor_cases_ci_id_fkey" FOREIGN KEY ("ci_id") REFERENCES "configuration_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_case_updates" ADD CONSTRAINT "vendor_case_updates_vendor_case_id_fkey" FOREIGN KEY ("vendor_case_id") REFERENCES "vendor_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

