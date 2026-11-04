-- Agent enrollment links get a machine cap and an optional client change
-- reference (governance review, 2026-11-04).
--   * max_machines: how many machines one link may enroll. Links created
--     before this migration keep working with a cap of 50, or their current
--     count if already higher; they expire within 30 days anyway.
--   * change_reference: the client's change / CAB number, recorded in the
--     audit trail of every enrollment made with the link.
--
-- Rollback:
--   ALTER TABLE "agent_enrollments" DROP COLUMN "change_reference";
--   ALTER TABLE "agent_enrollments" DROP COLUMN "max_machines";

ALTER TABLE "agent_enrollments" ADD COLUMN "max_machines" INTEGER;
UPDATE "agent_enrollments" SET "max_machines" = GREATEST("enrolled_count", 50);
ALTER TABLE "agent_enrollments" ALTER COLUMN "max_machines" SET NOT NULL;

ALTER TABLE "agent_enrollments" ADD COLUMN "change_reference" VARCHAR(60);
