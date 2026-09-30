-- Per-priority offer windows and workload weights replace the single
-- offer_timeout_minutes. A site's existing window carries over as its P2
-- window (the old default, 5, matches the new P2 default).
-- Rollback: ADD COLUMN "offer_timeout_minutes" INTEGER NOT NULL DEFAULT 5,
-- copy offer_timeout_p2_minutes back into it, then DROP the eight new columns.

-- AlterTable
ALTER TABLE "routing_policies"
ADD COLUMN     "offer_timeout_p1_minutes" INTEGER NOT NULL DEFAULT 2,
ADD COLUMN     "offer_timeout_p2_minutes" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN     "offer_timeout_p3_minutes" INTEGER NOT NULL DEFAULT 10,
ADD COLUMN     "offer_timeout_p4_minutes" INTEGER NOT NULL DEFAULT 15,
ADD COLUMN     "workload_weight_p1" INTEGER NOT NULL DEFAULT 4,
ADD COLUMN     "workload_weight_p2" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "workload_weight_p3" INTEGER NOT NULL DEFAULT 2,
ADD COLUMN     "workload_weight_p4" INTEGER NOT NULL DEFAULT 1;

UPDATE "routing_policies" SET "offer_timeout_p2_minutes" = "offer_timeout_minutes";

ALTER TABLE "routing_policies" DROP COLUMN "offer_timeout_minutes";
