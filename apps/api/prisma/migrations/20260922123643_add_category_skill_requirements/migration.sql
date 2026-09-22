-- CreateTable
CREATE TABLE "category_skill_requirements" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "skill_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "category_skill_requirements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "category_skill_requirements_skill_id_idx" ON "category_skill_requirements"("skill_id");

-- CreateIndex
CREATE UNIQUE INDEX "category_skill_requirements_category_skill_id_key" ON "category_skill_requirements"("category", "skill_id");

-- AddForeignKey
ALTER TABLE "category_skill_requirements" ADD CONSTRAINT "category_skill_requirements_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "skills"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
