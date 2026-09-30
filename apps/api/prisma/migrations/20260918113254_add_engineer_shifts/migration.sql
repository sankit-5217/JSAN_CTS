-- CreateTable
CREATE TABLE "engineer_shifts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "days_of_week" INTEGER[],
    "start_time" TEXT NOT NULL,
    "end_time" TEXT NOT NULL,
    "is_on_call" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "engineer_shifts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "engineer_shifts_user_id_idx" ON "engineer_shifts"("user_id");

-- CreateIndex
CREATE INDEX "engineer_shifts_site_id_idx" ON "engineer_shifts"("site_id");

-- AddForeignKey
ALTER TABLE "engineer_shifts" ADD CONSTRAINT "engineer_shifts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engineer_shifts" ADD CONSTRAINT "engineer_shifts_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
