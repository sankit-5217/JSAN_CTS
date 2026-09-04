-- Problems & RCA module (spec §10.5, owner: Dev B).

-- CreateEnum
CREATE TYPE "ProblemStatus" AS ENUM ('OPEN', 'INVESTIGATING', 'KNOWN_ERROR', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "ProblemLinkType" AS ENUM ('INCIDENT', 'CHANGE');

-- CreateTable
CREATE TABLE "problems" (
    "id" TEXT NOT NULL,
    "problem_no" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "ProblemStatus" NOT NULL DEFAULT 'OPEN',
    "priority" "Priority",
    "symptoms" TEXT NOT NULL,
    "known_error" TEXT,
    "root_cause" TEXT,
    "corrective_action" TEXT,
    "preventive_action" TEXT,
    "owner_user_id" TEXT,
    "due_date" TIMESTAMP(3),
    "resolved_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "problems_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "problem_action_items" (
    "id" TEXT NOT NULL,
    "problem_id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "assignee_user_id" TEXT,
    "due_date" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "problem_action_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "problem_links" (
    "id" TEXT NOT NULL,
    "problem_id" TEXT NOT NULL,
    "entity_type" "ProblemLinkType" NOT NULL,
    "entity_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "problem_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "problems_problem_no_key" ON "problems"("problem_no");

-- CreateIndex
CREATE INDEX "problems_status_idx" ON "problems"("status");

-- CreateIndex
CREATE INDEX "problem_action_items_problem_id_idx" ON "problem_action_items"("problem_id");

-- CreateIndex
CREATE INDEX "problem_links_entity_type_entity_id_idx" ON "problem_links"("entity_type", "entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "problem_links_problem_id_entity_type_entity_id_key" ON "problem_links"("problem_id", "entity_type", "entity_id");

-- AddForeignKey
ALTER TABLE "problem_action_items" ADD CONSTRAINT "problem_action_items_problem_id_fkey" FOREIGN KEY ("problem_id") REFERENCES "problems"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "problem_links" ADD CONSTRAINT "problem_links_problem_id_fkey" FOREIGN KEY ("problem_id") REFERENCES "problems"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateSequence: atomic problem numbering (PRB-000001), same rationale as
-- incident_no_seq — not representable in Prisma's schema DSL.
CREATE SEQUENCE IF NOT EXISTS "problem_no_seq" START 1;

-- Rollback:
--   DROP SEQUENCE "problem_no_seq";
--   DROP TABLE "problem_links";
--   DROP TABLE "problem_action_items";
--   DROP TABLE "problems";
--   DROP TYPE "ProblemLinkType";
--   DROP TYPE "ProblemStatus";
