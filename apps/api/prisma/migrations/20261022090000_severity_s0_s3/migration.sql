-- Issue template Severity list becomes S0, S1, S2, S3 (user's call,
-- 2026-10-22). Data only.
--   * The old Blocker/Critical/Major/Minor/Trivial options are retired
--     (is_active = false), never deleted, so old tickets keep their label.
--     Any other severity an admin added is retired too: the list is exactly
--     S0-S3.
--   * A template whose default severity was retired loses that default
--     rather than prefilling a value the form no longer offers.
--
-- Rollback:
--   UPDATE "issue_catalog_options" SET "is_active" = false, "updated_at" = now()
--     WHERE "kind" = 'SEVERITY' AND "value" IN ('S0','S1','S2','S3');
--   UPDATE "issue_catalog_options" SET "is_active" = true, "updated_at" = now()
--     WHERE "kind" = 'SEVERITY' AND "value" IN ('BLOCKER','CRITICAL','MAJOR','MINOR','TRIVIAL');
--   (template default severities cleared here are not restored)

UPDATE "issue_catalog_options" SET "is_active" = false, "updated_at" = now()
WHERE "kind" = 'SEVERITY' AND "value" NOT IN ('S0','S1','S2','S3');

INSERT INTO "issue_catalog_options" ("id", "kind", "value", "label", "sort_order", "is_active", "created_at", "updated_at")
VALUES (gen_random_uuid()::text, 'SEVERITY', 'S0', 'S0', 0, true, now(), now()),
       (gen_random_uuid()::text, 'SEVERITY', 'S1', 'S1', 1, true, now(), now()),
       (gen_random_uuid()::text, 'SEVERITY', 'S2', 'S2', 2, true, now(), now()),
       (gen_random_uuid()::text, 'SEVERITY', 'S3', 'S3', 3, true, now(), now())
ON CONFLICT ("kind", "value") DO UPDATE SET "is_active" = true, "updated_at" = now();

UPDATE "issue_templates" SET "default_severity" = NULL, "updated_at" = now()
WHERE "default_severity" IS NOT NULL
  AND "default_severity" NOT IN ('S0','S1','S2','S3');
