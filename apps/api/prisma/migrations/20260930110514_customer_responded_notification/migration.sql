-- A client replying on their ticket, or telling the desk whether a resolved
-- ticket is really fixed, gets its own bell notification (and sound tier).
-- Rollback: DELETE FROM "in_app_notifications" WHERE kind = 'CUSTOMER_RESPONDED';
-- DELETE FROM "notification_sound_rules" WHERE kind = 'CUSTOMER_RESPONDED'; then
-- recreate "InAppNotificationKind" without it (Postgres can't drop an enum value).

-- AlterEnum
ALTER TYPE "InAppNotificationKind" ADD VALUE 'CUSTOMER_RESPONDED';
