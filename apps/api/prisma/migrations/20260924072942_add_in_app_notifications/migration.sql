-- CreateEnum
CREATE TYPE "InAppNotificationKind" AS ENUM ('INCIDENT_CREATED', 'INCIDENT_ASSIGNED', 'INCIDENT_GROUP_ASSIGNED', 'INCIDENT_STATUS_CHANGED', 'INCIDENT_COMMENT_ADDED', 'SLA_WARNING', 'SLA_BREACHED');

-- CreateTable
CREATE TABLE "in_app_notifications" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "kind" "InAppNotificationKind" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "in_app_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "in_app_notifications_user_id_created_at_idx" ON "in_app_notifications"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "in_app_notifications_created_at_idx" ON "in_app_notifications"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "in_app_notifications_user_id_dedupe_key_key" ON "in_app_notifications"("user_id", "dedupe_key");

-- AddForeignKey
ALTER TABLE "in_app_notifications" ADD CONSTRAINT "in_app_notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
