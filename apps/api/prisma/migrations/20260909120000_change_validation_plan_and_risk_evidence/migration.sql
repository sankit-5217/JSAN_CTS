-- Two spec-compliance fields (§10.6, §10.15).

-- §10.6: a change record's fields include a "validation plan" distinct from the
-- implementation and rollback plans. Added NOT NULL; existing rows backfill to ''
-- (then the default is dropped so new rows must supply one, like the sibling
-- plan columns).
ALTER TABLE "changes" ADD COLUMN "validation_plan" TEXT NOT NULL DEFAULT '';
ALTER TABLE "changes" ALTER COLUMN "validation_plan" DROP DEFAULT;

-- §10.15: a risk register entry's fields include "evidence". Nullable, same as
-- "mitigation" — a risk can be logged before evidence is attached.
ALTER TABLE "risks" ADD COLUMN "evidence" TEXT;

-- Rollback:
--   ALTER TABLE "risks" DROP COLUMN "evidence";
--   ALTER TABLE "changes" DROP COLUMN "validation_plan";
