-- AlterEnum
ALTER TYPE "InAppNotificationKind" ADD VALUE 'ALERT_RECOVERED';

-- AlterTable
ALTER TABLE "alert_rules" ADD COLUMN     "auto_create_severities" "AlertSeverity"[] DEFAULT ARRAY['CRITICAL']::"AlertSeverity"[],
ADD COLUMN     "incident_category" TEXT,
ADD COLUMN     "incident_priority" "Priority";
