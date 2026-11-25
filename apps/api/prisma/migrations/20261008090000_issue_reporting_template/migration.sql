-- "Report an issue" template (client portal): DB-configured pick-lists
-- (issue_catalog_options), one auto-draft template per issue type
-- (issue_templates), the template's fields on incidents (description,
-- issue_type, severity, component, sub_component, tool, ref_incident_no,
-- cc_emails) and a single default "Assignee Group" flag on support_groups.
-- Rollback:
--   ALTER TABLE "issue_templates" DROP CONSTRAINT "issue_templates_issue_type_id_fkey";
--   ALTER TABLE "issue_catalog_options" DROP CONSTRAINT "issue_catalog_options_parent_id_fkey";
--   DROP TABLE "issue_templates"; DROP TABLE "issue_catalog_options";
--   DROP INDEX "support_groups_is_default_assignee_key";
--   ALTER TABLE "support_groups" DROP COLUMN "is_default_assignee";
--   ALTER TABLE "incidents" DROP COLUMN "cc_emails", DROP COLUMN "component",
--     DROP COLUMN "description", DROP COLUMN "issue_type", DROP COLUMN "ref_incident_no",
--     DROP COLUMN "severity", DROP COLUMN "sub_component", DROP COLUMN "tool";
--   DROP TYPE "IssueCatalogKind";
-- (incident columns are nullable/defaulted additive columns — rolling back
-- loses only the template detail on tickets created after this migration.)

-- CreateEnum
CREATE TYPE "IssueCatalogKind" AS ENUM ('ISSUE_TYPE', 'PRIORITY', 'SEVERITY', 'COMPONENT', 'SUB_COMPONENT', 'TOOL');

-- AlterTable
ALTER TABLE "incidents" ADD COLUMN     "cc_emails" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "component" TEXT,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "issue_type" TEXT,
ADD COLUMN     "ref_incident_no" TEXT,
ADD COLUMN     "severity" TEXT,
ADD COLUMN     "sub_component" TEXT,
ADD COLUMN     "tool" TEXT;

-- AlterTable
ALTER TABLE "support_groups" ADD COLUMN     "is_default_assignee" BOOLEAN;

-- CreateTable
CREATE TABLE "issue_catalog_options" (
    "id" TEXT NOT NULL,
    "kind" "IssueCatalogKind" NOT NULL,
    "value" VARCHAR(64) NOT NULL,
    "label" VARCHAR(120) NOT NULL,
    "parent_id" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "issue_catalog_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "issue_templates" (
    "id" TEXT NOT NULL,
    "issue_type_id" TEXT NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "subject_draft" VARCHAR(256),
    "description_draft" TEXT NOT NULL,
    "default_priority" "Priority",
    "default_severity" VARCHAR(64),
    "default_component" VARCHAR(64),
    "default_sub_component" VARCHAR(64),
    "default_tool" VARCHAR(64),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "issue_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "issue_catalog_options_kind_is_active_sort_order_idx" ON "issue_catalog_options"("kind", "is_active", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "issue_catalog_options_kind_value_key" ON "issue_catalog_options"("kind", "value");

-- CreateIndex
CREATE UNIQUE INDEX "issue_templates_issue_type_id_key" ON "issue_templates"("issue_type_id");

-- CreateIndex
CREATE UNIQUE INDEX "support_groups_is_default_assignee_key" ON "support_groups"("is_default_assignee");

-- AddForeignKey
ALTER TABLE "issue_catalog_options" ADD CONSTRAINT "issue_catalog_options_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "issue_catalog_options"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue_templates" ADD CONSTRAINT "issue_templates_issue_type_id_fkey" FOREIGN KEY ("issue_type_id") REFERENCES "issue_catalog_options"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

