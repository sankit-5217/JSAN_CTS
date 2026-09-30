-- CreateTable
CREATE TABLE "category_teams" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "group_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "category_teams_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "category_teams_category_key" ON "category_teams"("category");

-- CreateIndex
CREATE INDEX "category_teams_group_id_idx" ON "category_teams"("group_id");

-- AddForeignKey
ALTER TABLE "category_teams" ADD CONSTRAINT "category_teams_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "support_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
