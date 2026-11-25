-- Zabbix API connection (monitoring module): admin-editable URL, timeout and
-- an encrypted API token. Purely additive — no existing table is touched.
-- Rollback:
--   DROP TABLE "zabbix_connections";
-- (loses only the stored Zabbix URL/token; re-run the seed to recreate the
-- default row and re-enter the token on the Zabbix settings page.)

-- CreateTable
CREATE TABLE "zabbix_connections" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "api_url" VARCHAR(500) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "request_timeout_ms" INTEGER NOT NULL DEFAULT 10000,
    "token_ciphertext" TEXT,
    "token_last4" VARCHAR(4),
    "token_updated_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "zabbix_connections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "zabbix_connections_name_key" ON "zabbix_connections"("name");
