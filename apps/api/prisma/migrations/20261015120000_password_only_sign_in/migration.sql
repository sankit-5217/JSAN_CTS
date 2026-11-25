-- Sign-in becomes email + password only: Google / Microsoft / GitHub sign-in
-- is removed, so its linked identities and login handoff codes go. Checked
-- before dropping (2026-10-15): no production user had a linked identity,
-- and every user has a password.
-- A Super Admin may now set a user's starting password; the user must pick
-- their own at first sign-in (must_change_password).
--
-- Rollback (data in the dropped tables is lost; it was empty in production):
--   ALTER TABLE "users" DROP COLUMN "must_change_password";
--   CREATE TABLE "user_identities" ("id" TEXT NOT NULL, "user_id" TEXT NOT NULL,
--     "provider" TEXT NOT NULL, "issuer" TEXT NOT NULL, "subject" TEXT NOT NULL, "email" TEXT,
--     "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "last_login_at" TIMESTAMP(3),
--     CONSTRAINT "user_identities_pkey" PRIMARY KEY ("id"));
--   CREATE UNIQUE INDEX "user_identities_issuer_subject_key" ON "user_identities"("issuer", "subject");
--   CREATE UNIQUE INDEX "user_identities_user_id_provider_key" ON "user_identities"("user_id", "provider");
--   ALTER TABLE "user_identities" ADD CONSTRAINT "user_identities_user_id_fkey" FOREIGN KEY ("user_id")
--     REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
--   CREATE TABLE "login_handoff_codes" ("id" TEXT NOT NULL, "code_hash" TEXT NOT NULL,
--     "user_id" TEXT NOT NULL, "expires_at" TIMESTAMP(3) NOT NULL, "consumed_at" TIMESTAMP(3),
--     "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
--     CONSTRAINT "login_handoff_codes_pkey" PRIMARY KEY ("id"));
--   CREATE UNIQUE INDEX "login_handoff_codes_code_hash_key" ON "login_handoff_codes"("code_hash");
--   CREATE INDEX "login_handoff_codes_expires_at_idx" ON "login_handoff_codes"("expires_at");
--   ALTER TABLE "login_handoff_codes" ADD CONSTRAINT "login_handoff_codes_user_id_fkey" FOREIGN KEY ("user_id")
--     REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
--   (and redeploy the previous API build)

-- DropForeignKey
ALTER TABLE "login_handoff_codes" DROP CONSTRAINT "login_handoff_codes_user_id_fkey";

-- DropForeignKey
ALTER TABLE "user_identities" DROP CONSTRAINT "user_identities_user_id_fkey";

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "must_change_password" BOOLEAN NOT NULL DEFAULT false;

-- DropTable
DROP TABLE "login_handoff_codes";

-- DropTable
DROP TABLE "user_identities";
