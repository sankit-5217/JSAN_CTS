-- Issue template v2 (client portal "Report an issue", ticket page, staff
-- incident page):
--   * IncidentStatus gains BLOCKED ("Blocked by") and DUPLICATE ("Duplicate
--     of") for the template's Status list.
--   * attachments.comment_id: a file sent with a conversation message.
--   * support_groups.is_client_selectable: which groups a client may pick
--     as Assignee Group (JSAN ServiceDesk and Infra team to start with).
--   * Data: the user's pick-lists replace the generic placeholders the
--     2026-10-08 seed wrote. Placeholders are retired (is_active = false),
--     never deleted, so old tickets keep resolving their labels. Options an
--     admin added themselves are not touched.
--
-- Rollback:
--   ALTER TABLE "attachments" DROP CONSTRAINT "attachments_comment_id_fkey";
--   DROP INDEX "attachments_comment_id_idx";
--   ALTER TABLE "attachments" DROP COLUMN "comment_id";
--   ALTER TABLE "support_groups" DROP COLUMN "is_client_selectable";
--   UPDATE "issue_catalog_options" SET "is_active" = false
--     WHERE "value" IN ('BUG','PROCESS_REQUEST','CHANGE_REQUEST','FEATURE_REQUEST','OTHER_REQUEST')
--        OR "value" IN ('HW','SW','NW','OTHERS','TOOLS') OR "value" LIKE 'HW.%' OR "value" LIKE 'SW.%'
--        OR "value" LIKE 'NW.%' OR "value" LIKE 'OTHERS.%' OR "value" LIKE 'TOOLS.%';
--   (then set "is_active" = true on the retired placeholder values listed below)
--   Postgres can't drop an enum value: move any BLOCKED/DUPLICATE incidents
--   to IN_PROGRESS/CANCELLED first, then recreate "IncidentStatus" without
--   them (rename type, create the old one, ALTER COLUMN ... USING status::text::"IncidentStatus").

-- AlterEnum
ALTER TYPE "IncidentStatus" ADD VALUE 'BLOCKED';
ALTER TYPE "IncidentStatus" ADD VALUE 'DUPLICATE';

-- AlterTable
ALTER TABLE "attachments" ADD COLUMN "comment_id" TEXT;

-- AlterTable
ALTER TABLE "support_groups" ADD COLUMN "is_client_selectable" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "attachments_comment_id_idx" ON "attachments"("comment_id");

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_comment_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "incident_comments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Data: Assignee Groups a client can pick.
INSERT INTO "support_groups" ("id", "name", "is_client_selectable", "created_at")
VALUES (gen_random_uuid()::text, 'JSAN ServiceDesk', true, now()),
       (gen_random_uuid()::text, 'Infra team', true, now())
ON CONFLICT ("name") DO UPDATE SET "is_client_selectable" = true;

-- Data: retire the generic placeholders.
UPDATE "issue_catalog_options" SET "is_active" = false, "updated_at" = now()
WHERE ("kind" = 'ISSUE_TYPE' AND "value" IN ('HARDWARE_FAILURE','NETWORK','POWER','COOLING','STORAGE','OS_SOFTWARE','MONITORING','ACCESS_REQUEST','SERVICE_REQUEST','OTHER'))
   OR ("kind" = 'COMPONENT' AND "value" IN ('SERVER','STORAGE','NETWORK','POWER','COOLING','FACILITY','SOFTWARE'))
   OR ("kind" = 'SUB_COMPONENT' AND split_part("value", '.', 1) IN ('SERVER','STORAGE','NETWORK','POWER','COOLING','FACILITY','SOFTWARE'))
   OR ("kind" = 'TOOL' AND "value" IN ('ZABBIX','PROMETHEUS','GRAFANA','LOKI','IDRAC','ILO','OPSDESK','VISUAL','OTHER'));

UPDATE "issue_templates" SET "is_active" = false, "updated_at" = now()
WHERE "issue_type_id" IN (
  SELECT "id" FROM "issue_catalog_options" WHERE "kind" = 'ISSUE_TYPE' AND "is_active" = false
);

-- Data: issue types (one template each, same names).
INSERT INTO "issue_catalog_options" ("id", "kind", "value", "label", "sort_order", "is_active", "created_at", "updated_at")
VALUES (gen_random_uuid()::text, 'ISSUE_TYPE', 'BUG', 'Bug', 0, true, now(), now()),
       (gen_random_uuid()::text, 'ISSUE_TYPE', 'PROCESS_REQUEST', 'Process request', 1, true, now(), now()),
       (gen_random_uuid()::text, 'ISSUE_TYPE', 'CHANGE_REQUEST', 'Change request', 2, true, now(), now()),
       (gen_random_uuid()::text, 'ISSUE_TYPE', 'FEATURE_REQUEST', 'Feature request', 3, true, now(), now()),
       (gen_random_uuid()::text, 'ISSUE_TYPE', 'OTHER_REQUEST', 'Other request', 4, true, now(), now())
ON CONFLICT ("kind", "value") DO NOTHING;

-- Data: components.
INSERT INTO "issue_catalog_options" ("id", "kind", "value", "label", "sort_order", "is_active", "created_at", "updated_at")
VALUES (gen_random_uuid()::text, 'COMPONENT', 'HW', 'Hardware', 0, true, now(), now()),
       (gen_random_uuid()::text, 'COMPONENT', 'SW', 'Software', 1, true, now(), now()),
       (gen_random_uuid()::text, 'COMPONENT', 'NW', 'NW', 2, true, now(), now()),
       (gen_random_uuid()::text, 'COMPONENT', 'OTHERS', 'Others', 3, true, now(), now()),
       (gen_random_uuid()::text, 'COMPONENT', 'TOOLS', 'Tools', 4, true, now(), now())
ON CONFLICT ("kind", "value") DO NOTHING;

-- Data: sub components, under their component.
INSERT INTO "issue_catalog_options" ("id", "kind", "value", "label", "parent_id", "sort_order", "is_active", "created_at", "updated_at")
SELECT gen_random_uuid()::text, 'SUB_COMPONENT', s.value, s.label, c."id", s.sort_order, true, now(), now()
FROM (VALUES
  ('HW', 'HW.SERVER', 'HW-Server', 0),
  ('HW', 'HW.FIREWALL', 'Firewall', 1),
  ('HW', 'HW.PDU', 'PDU', 2),
  ('HW', 'HW.UPS', 'UPS', 3),
  ('HW', 'HW.OTHERS', 'Others', 4),
  ('SW', 'SW.SW1', 'SW1', 0),
  ('SW', 'SW.SW2', 'SW2', 1),
  ('SW', 'SW.SW3', 'SW3', 2),
  ('SW', 'SW.OS', 'OS', 3),
  ('SW', 'SW.FIRMWARE', 'Firmware', 4),
  ('NW', 'NW.ISP', 'ISP', 0),
  ('NW', 'NW.FW', 'FW', 1),
  ('NW', 'NW.WIFI', 'Wifi', 2),
  ('OTHERS', 'OTHERS.POWER', 'Power', 0),
  ('OTHERS', 'OTHERS.AC', 'AC', 1),
  ('OTHERS', 'OTHERS.CCTV', 'CCTV', 2),
  ('TOOLS', 'TOOLS.DRIVEFLUX', 'DriveFlux', 0),
  ('TOOLS', 'TOOLS.DISKSQUAD', 'DiskSquad', 1),
  ('TOOLS', 'TOOLS.ANYDESK', 'Anydesk', 2),
  ('TOOLS', 'TOOLS.OTHERS', 'Others', 3)
) AS s(component, value, label, sort_order)
JOIN "issue_catalog_options" c ON c."kind" = 'COMPONENT' AND c."value" = s.component
ON CONFLICT ("kind", "value") DO NOTHING;

-- Data: the five templates.
INSERT INTO "issue_templates" ("id", "issue_type_id", "name", "subject_draft", "description_draft", "default_priority", "is_active", "created_at", "updated_at")
SELECT gen_random_uuid()::text, o."id", t.name, t.subject_draft, t.description_draft, 'P3'::"Priority", true, now(), now()
FROM (VALUES
  ('BUG', 'Bug', '[Bug] <system / device> - <what is wrong>',
   E'What is wrong:\n\nSteps to reproduce:\n1. \n\nExpected result:\n\nActual result:\n\nWhen did it start?\n\nAlready tried:\n'),
  ('PROCESS_REQUEST', 'Process request', '[Process] <process> - <what you need>',
   E'Which process:\n\nWhat you need done:\n\nNeeded by (date / time):\n\nApprovals (if any):\n'),
  ('CHANGE_REQUEST', 'Change request', '[Change] <system / device> - <change>',
   E'What should change:\n\nWhy (business reason):\n\nAffected systems / devices:\n\nPreferred maintenance window:\n\nRollback plan:\n'),
  ('FEATURE_REQUEST', 'Feature request', '[Feature] <what you would like>',
   E'What you would like:\n\nWhy it helps:\n\nWho will use it:\n'),
  ('OTHER_REQUEST', 'Other request', '[Request] <short summary>',
   E'What you need:\n\nAny details that help:\n')
) AS t(issue_type, name, subject_draft, description_draft)
JOIN "issue_catalog_options" o ON o."kind" = 'ISSUE_TYPE' AND o."value" = t.issue_type
ON CONFLICT ("issue_type_id") DO NOTHING;
