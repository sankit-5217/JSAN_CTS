-- Alert dedup rule 5 (spec §10.10): an approved maintenance window on the CI
-- suppresses auto-ticketing when this is true, otherwise the alert is only
-- labelled expected.

-- AlterTable
ALTER TABLE "alert_rules" ADD COLUMN     "suppress_auto_ticket_during_maintenance" BOOLEAN NOT NULL DEFAULT true;

-- Rollback:
--   ALTER TABLE "alert_rules" DROP COLUMN "suppress_auto_ticket_during_maintenance";
