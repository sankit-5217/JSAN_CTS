-- CreateTable
CREATE TABLE "alert_rules" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "flapping_threshold" INTEGER NOT NULL DEFAULT 3,
    "flapping_window_minutes" INTEGER NOT NULL DEFAULT 30,
    "paging_severities" "AlertSeverity"[] DEFAULT ARRAY['CRITICAL']::"AlertSeverity"[],
    "auto_correlate_incidents" BOOLEAN NOT NULL DEFAULT true,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "alert_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "alert_rules_is_active_idx" ON "alert_rules"("is_active");

-- Rollback:
--   DROP TABLE "alert_rules";
