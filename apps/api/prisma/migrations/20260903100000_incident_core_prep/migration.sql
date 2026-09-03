-- Sprint 4 (Incident Core) prep: two schema gaps + an atomic numbering sequence.
-- See docs/JSAN_CTS_DC_OpsDesk_Developer_Build_Architecture_v1.0.pdf §15 and §13.1.

-- AlterTable: spec §15's ASSIGNED -> ACKNOWLEDGED transition requires storing
-- an acknowledged timestamp; no column existed for it.
ALTER TABLE "incidents" ADD COLUMN     "acknowledged_at" TIMESTAMP(3);

-- AddForeignKey: owner_group_id was a bare column with no FK to support_groups,
-- violating spec §13.1 ("use foreign keys for core relationships").
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_owner_group_id_fkey" FOREIGN KEY ("owner_group_id") REFERENCES "support_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateSequence: atomic incident numbering (nextval avoids the race a
-- count()+1 approach would have under concurrent incident creation). Not
-- representable in Prisma's schema DSL, so this is hand-added rather than
-- diff-generated.
CREATE SEQUENCE IF NOT EXISTS "incident_no_seq" START 1;
