-- Two spec tweaks (§10.6, §10.13).

-- AlterTable: per-CI maintenance-window scoping. Default empty = site-wide window.
ALTER TABLE "changes" ADD COLUMN     "affected_ci_ids" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateIndex: a vendor case number is an external identity and must be unique
-- (idempotent case creation). Fails if duplicates already exist — de-dup first
-- on an established database.
CREATE UNIQUE INDEX "vendor_cases_vendor_case_no_key" ON "vendor_cases"("vendor_case_no");

-- Rollback:
--   DROP INDEX "vendor_cases_vendor_case_no_key";
--   ALTER TABLE "changes" DROP COLUMN "affected_ci_ids";
