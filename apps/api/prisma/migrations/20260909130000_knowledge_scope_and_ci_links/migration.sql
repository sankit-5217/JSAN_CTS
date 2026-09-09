-- §10.14: knowledge articles are site-specific SOPs or global runbooks, and
-- link to an incident category and a CI type. All nullable — an article can be
-- a global, untyped runbook (site_id NULL).
ALTER TABLE "knowledge_articles" ADD COLUMN "site_id" TEXT;
ALTER TABLE "knowledge_articles" ADD COLUMN "incident_category" TEXT;
ALTER TABLE "knowledge_articles" ADD COLUMN "ci_type" "CiType";

CREATE INDEX "knowledge_articles_site_id_idx" ON "knowledge_articles"("site_id");

-- Rollback:
--   DROP INDEX "knowledge_articles_site_id_idx";
--   ALTER TABLE "knowledge_articles" DROP COLUMN "ci_type";
--   ALTER TABLE "knowledge_articles" DROP COLUMN "incident_category";
--   ALTER TABLE "knowledge_articles" DROP COLUMN "site_id";
