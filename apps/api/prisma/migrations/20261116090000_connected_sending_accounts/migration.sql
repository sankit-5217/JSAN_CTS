CREATE TABLE "sending_accounts" (
 "user_id" TEXT PRIMARY KEY REFERENCES "users"("id") ON DELETE CASCADE,
 "provider" TEXT NOT NULL, "email" TEXT NOT NULL, "credentials" TEXT NOT NULL,
 "updated_at" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "mail_authorizations" (
 "used_at" TIMESTAMP(3), "state_hash" TEXT PRIMARY KEY, "user_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
 "session_version" INTEGER NOT NULL, "provider" TEXT NOT NULL, "verifier" TEXT NOT NULL,
 "expires_at" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "mail_authorizations_expires_at_idx" ON "mail_authorizations"("expires_at");
