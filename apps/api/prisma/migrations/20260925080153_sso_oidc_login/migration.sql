-- Real SSO/OIDC login (spec §7, §17). Additive only: existing users keep
-- idp_issuer NULL = "not yet linked"; their first SSO login (matched by
-- email) links them. dev-login is unaffected.

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "idp_issuer" TEXT;

-- CreateTable
CREATE TABLE "sso_login_codes" (
    "id" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sso_login_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sso_login_codes_code_hash_key" ON "sso_login_codes"("code_hash");

-- CreateIndex
CREATE INDEX "sso_login_codes_expires_at_idx" ON "sso_login_codes"("expires_at");

-- AddForeignKey
ALTER TABLE "sso_login_codes" ADD CONSTRAINT "sso_login_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Rollback:
--   DROP TABLE "sso_login_codes";
--   ALTER TABLE "users" DROP COLUMN "idp_issuer";
