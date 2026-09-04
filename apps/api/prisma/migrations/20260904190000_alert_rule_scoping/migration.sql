-- Per-site / per-alert-type alert rule overrides (spec §10.10). Both null on
-- an existing "default" row = the global rule.

-- AlterTable
ALTER TABLE "alert_rules" ADD COLUMN     "alert_type" TEXT,
ADD COLUMN     "site_id" TEXT;

-- CreateIndex
CREATE INDEX "alert_rules_site_id_idx" ON "alert_rules"("site_id");

-- Rollback:
--   DROP INDEX "alert_rules_site_id_idx";
--   ALTER TABLE "alert_rules" DROP COLUMN "site_id";
--   ALTER TABLE "alert_rules" DROP COLUMN "alert_type";
