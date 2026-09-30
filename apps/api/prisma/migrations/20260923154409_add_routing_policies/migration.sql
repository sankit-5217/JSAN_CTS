-- CreateTable
CREATE TABLE "routing_policies" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "auto_assign_enabled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "routing_policies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "routing_policies_site_id_key" ON "routing_policies"("site_id");

-- AddForeignKey
ALTER TABLE "routing_policies" ADD CONSTRAINT "routing_policies_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Rollback:
--   DROP TABLE "routing_policies";
