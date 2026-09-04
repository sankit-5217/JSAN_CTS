-- AlterTable
ALTER TABLE "sla_policies" ADD COLUMN     "escalation_thresholds_percent" INTEGER[] DEFAULT ARRAY[50, 75, 90]::INTEGER[],
ADD COLUMN     "pauses_on_pending_customer" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "pauses_on_pending_vendor" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "uses_business_calendar" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "sla_instances" ADD COLUMN     "fired_milestones" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "paused_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "sla_policies_priority_is_active_idx" ON "sla_policies"("priority", "is_active");

