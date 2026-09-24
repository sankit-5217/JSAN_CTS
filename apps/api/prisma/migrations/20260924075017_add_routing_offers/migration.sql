-- CreateEnum
CREATE TYPE "RoutingOfferStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'CANCELLED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "InAppNotificationKind" ADD VALUE 'INCIDENT_OFFERED';
ALTER TYPE "InAppNotificationKind" ADD VALUE 'INCIDENT_OFFER_UNACCEPTED';

-- AlterTable
ALTER TABLE "routing_policies" ADD COLUMN     "offer_timeout_minutes" INTEGER NOT NULL DEFAULT 5;

-- CreateTable
CREATE TABLE "routing_offers" (
    "id" TEXT NOT NULL,
    "incident_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "status" "RoutingOfferStatus" NOT NULL DEFAULT 'PENDING',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "responded_at" TIMESTAMP(3),
    "decline_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "routing_offers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "routing_offers_incident_id_status_idx" ON "routing_offers"("incident_id", "status");

-- CreateIndex
CREATE INDEX "routing_offers_status_expires_at_idx" ON "routing_offers"("status", "expires_at");

-- CreateIndex
CREATE INDEX "routing_offers_user_id_status_idx" ON "routing_offers"("user_id", "status");

-- AddForeignKey
ALTER TABLE "routing_offers" ADD CONSTRAINT "routing_offers_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "incidents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routing_offers" ADD CONSTRAINT "routing_offers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
