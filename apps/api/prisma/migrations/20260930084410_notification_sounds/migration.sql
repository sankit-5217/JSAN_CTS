-- Notification sounds: each in-app notification carries the sound tier the
-- ops console plays for it, resolved from notification_sound_rules (kind x
-- level) when the row is written. No rows are seeded: until an admin saves
-- one, the inbox module's code default applies (same as alert_rules).
-- Existing notifications get NORMAL; the browser only sounds new arrivals.
-- Rollback: DROP TABLE "notification_sound_rules"; ALTER TABLE
-- "in_app_notifications" DROP COLUMN "urgency"; DROP TYPE "NotificationUrgency";
-- DELETE FROM "in_app_notifications" WHERE kind = 'ALERT_RAISED', then recreate
-- "InAppNotificationKind" without ALERT_RAISED (Postgres can't drop an enum value).

-- CreateEnum
CREATE TYPE "NotificationUrgency" AS ENUM ('CRITICAL', 'HIGH', 'NORMAL', 'SILENT');

-- AlterEnum
ALTER TYPE "InAppNotificationKind" ADD VALUE 'ALERT_RAISED';

-- AlterTable
ALTER TABLE "in_app_notifications" ADD COLUMN     "urgency" "NotificationUrgency" NOT NULL DEFAULT 'NORMAL';

-- CreateTable
CREATE TABLE "notification_sound_rules" (
    "id" TEXT NOT NULL,
    "kind" "InAppNotificationKind" NOT NULL,
    "level" INTEGER NOT NULL,
    "urgency" "NotificationUrgency" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_sound_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "notification_sound_rules_kind_level_key" ON "notification_sound_rules"("kind", "level");

-- level is 1-4: incident priority P1-P4, or alert severity CRITICAL-INFO.
ALTER TABLE "notification_sound_rules" ADD CONSTRAINT "notification_sound_rules_level_check" CHECK ("level" BETWEEN 1 AND 4);
