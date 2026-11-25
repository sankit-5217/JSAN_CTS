-- One-line monitoring agent enrollment (per-site links) and the public
-- address client agents connect out to.
--
-- Rollback:
--   DROP TABLE "agent_enrollments";
--   ALTER TABLE "zabbix_connections" DROP COLUMN "agent_server_address";
--   (and redeploy the previous API build). Agents already enrolled keep
--   working — their hosts live in Zabbix, not in these tables.

-- AlterTable
ALTER TABLE "zabbix_connections" ADD COLUMN "agent_server_address" VARCHAR(255);

-- CreateTable
CREATE TABLE "agent_enrollments" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "label" VARCHAR(120),
    "code_hash" VARCHAR(64) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "enrolled_count" INTEGER NOT NULL DEFAULT 0,
    "last_used_at" TIMESTAMP(3),
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agent_enrollments_code_hash_key" ON "agent_enrollments"("code_hash");

-- CreateIndex
CREATE INDEX "agent_enrollments_site_id_idx" ON "agent_enrollments"("site_id");

-- AddForeignKey
ALTER TABLE "agent_enrollments" ADD CONSTRAINT "agent_enrollments_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
