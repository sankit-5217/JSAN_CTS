-- CreateTable
CREATE TABLE "support_group_members" (
    "id" TEXT NOT NULL,
    "group_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_group_members_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "support_group_members_user_id_idx" ON "support_group_members"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "support_group_members_group_id_user_id_key" ON "support_group_members"("group_id", "user_id");

-- AddForeignKey
ALTER TABLE "support_group_members" ADD CONSTRAINT "support_group_members_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "support_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_group_members" ADD CONSTRAINT "support_group_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
