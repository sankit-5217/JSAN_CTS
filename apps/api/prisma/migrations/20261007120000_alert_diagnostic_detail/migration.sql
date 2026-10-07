-- Persist the diagnostic detail adapters already normalize (summary, failing
-- component, size-capped source metadata) on each alert, and track open
-- per-component hardware alerts on the CI's health snapshot.
-- Rollback: ALTER TABLE "alerts" DROP COLUMN "summary", DROP COLUMN "component_key",
-- DROP COLUMN "details"; ALTER TABLE "health_snapshots" DROP COLUMN "open_alerts";
-- (all nullable additive columns — no data is rewritten, so rollback loses only
-- the new detail; any per-component alerts still OPEN should be acknowledged
-- first, since the old code tracks a single rollup alert per CI).

-- AlterTable
ALTER TABLE "alerts" ADD COLUMN     "component_key" VARCHAR(128),
ADD COLUMN     "details" JSONB,
ADD COLUMN     "summary" VARCHAR(500);

-- AlterTable
ALTER TABLE "health_snapshots" ADD COLUMN     "open_alerts" JSONB;
