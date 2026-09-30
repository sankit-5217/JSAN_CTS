-- Password + social (Google/Microsoft/GitHub) sign-in replaces dev-login and
-- the generic OIDC/Keycloak SSO.
--  * users: drop idp_subject/idp_issuer (one-IdP-per-user model; nothing in
--    production ever linked through it) and add password + lockout + session
--    version columns. Every user starts with no password: they set one via an
--    emailed invite link.
--  * user_identities: many social sign-ins per user.
--  * password_tokens, api_tokens: invite/reset links and machine tokens (hashes only).
--  * sso_login_codes -> login_handoff_codes (short-lived, safe to drop).

-- DropForeignKey
ALTER TABLE "sso_login_codes" DROP CONSTRAINT "sso_login_codes_user_id_fkey";

-- DropIndex
DROP INDEX "users_idp_subject_key";

-- AlterTable
ALTER TABLE "users" DROP COLUMN "idp_issuer",
DROP COLUMN "idp_subject",
ADD COLUMN     "failed_login_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "locked_until" TIMESTAMP(3),
ADD COLUMN     "password_hash" TEXT,
ADD COLUMN     "password_set_at" TIMESTAMP(3),
ADD COLUMN     "session_version" INTEGER NOT NULL DEFAULT 0;

-- DropTable
DROP TABLE "sso_login_codes";

-- CreateTable
CREATE TABLE "user_identities" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "email" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_login_at" TIMESTAMP(3),

    CONSTRAINT "user_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3),
    "last_used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "login_handoff_codes" (
    "id" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_handoff_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_identities_issuer_subject_key" ON "user_identities"("issuer", "subject");

-- CreateIndex
CREATE UNIQUE INDEX "user_identities_user_id_provider_key" ON "user_identities"("user_id", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "password_tokens_token_hash_key" ON "password_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "password_tokens_user_id_idx" ON "password_tokens"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "api_tokens_token_hash_key" ON "api_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "api_tokens_user_id_idx" ON "api_tokens"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "login_handoff_codes_code_hash_key" ON "login_handoff_codes"("code_hash");

-- CreateIndex
CREATE INDEX "login_handoff_codes_expires_at_idx" ON "login_handoff_codes"("expires_at");

-- AddForeignKey
ALTER TABLE "user_identities" ADD CONSTRAINT "user_identities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_tokens" ADD CONSTRAINT "password_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "login_handoff_codes" ADD CONSTRAINT "login_handoff_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Rollback (data in the new tables is lost; old SSO links were already unused):
--   DROP TABLE "login_handoff_codes"; DROP TABLE "api_tokens";
--   DROP TABLE "password_tokens"; DROP TABLE "user_identities";
--   ALTER TABLE "users" DROP COLUMN "session_version", DROP COLUMN "password_set_at",
--     DROP COLUMN "password_hash", DROP COLUMN "locked_until", DROP COLUMN "failed_login_count",
--     ADD COLUMN "idp_issuer" TEXT, ADD COLUMN "idp_subject" TEXT;
--   UPDATE "users" SET "idp_subject" = 'restored|' || "id";
--   ALTER TABLE "users" ALTER COLUMN "idp_subject" SET NOT NULL;
--   CREATE UNIQUE INDEX "users_idp_subject_key" ON "users"("idp_subject");
--   then re-run 20260925080153_sso_oidc_login's CREATE TABLE "sso_login_codes".
