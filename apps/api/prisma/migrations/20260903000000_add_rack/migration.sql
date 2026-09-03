-- AlterTable
ALTER TABLE "configuration_items" ADD COLUMN     "rack_id" TEXT;

-- CreateTable
CREATE TABLE "racks" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "rack_code" TEXT NOT NULL,
    "name" TEXT,
    "location" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "racks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "racks_site_id_rack_code_key" ON "racks"("site_id", "rack_code");

-- CreateIndex
CREATE INDEX "configuration_items_rack_id_idx" ON "configuration_items"("rack_id");

-- AddForeignKey
ALTER TABLE "racks" ADD CONSTRAINT "racks_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "configuration_items" ADD CONSTRAINT "configuration_items_rack_id_fkey" FOREIGN KEY ("rack_id") REFERENCES "racks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

