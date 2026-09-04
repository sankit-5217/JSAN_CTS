-- BCP plans (spec §10.15, owner: Dev B / risks module).

-- CreateTable
CREATE TABLE "bcp_plans" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "site_id" TEXT,
    "service_name" TEXT,
    "recovery_strategy" TEXT NOT NULL,
    "alternate_site" TEXT,
    "rto_minutes" INTEGER NOT NULL,
    "rpo_minutes" INTEGER NOT NULL,
    "target_availability_percent" DOUBLE PRECISION,
    "residual_risk" TEXT,
    "contacts" TEXT,
    "owner_id" TEXT,
    "last_tested_at" TIMESTAMP(3),
    "next_test_due_at" TIMESTAMP(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bcp_plans_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bcp_plans_site_id_idx" ON "bcp_plans"("site_id");

-- CreateIndex
CREATE INDEX "bcp_plans_is_active_idx" ON "bcp_plans"("is_active");

-- Rollback:
--   DROP TABLE "bcp_plans";
