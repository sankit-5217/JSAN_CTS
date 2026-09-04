-- AlterTable
ALTER TABLE "alerts" ADD COLUMN     "correlated_incident_id" TEXT;

-- CreateIndex
CREATE INDEX "alerts_correlated_incident_id_idx" ON "alerts"("correlated_incident_id");

-- Rollback:
--   DROP INDEX "alerts_correlated_incident_id_idx";
--   ALTER TABLE "alerts" DROP COLUMN "correlated_incident_id";
