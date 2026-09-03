-- Sprint 5 (Worklogs + Attachments) prep: attachments.uploaded_by_id was a
-- bare column with no FK to users, violating spec §13.1 ("use foreign keys
-- for core relationships") -- same category of gap Sprint 4 fixed for
-- incidents.owner_group_id.
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
