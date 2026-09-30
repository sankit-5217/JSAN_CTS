/**
 * Runs before the test framework and before any module (PrismaClient,
 * @nestjs/config) reads the environment. Two jobs:
 *
 *  1. Point DATABASE_URL at an isolated `e2e` schema in the dev database, so an
 *     e2e run can TRUNCATE freely without touching `public`. Override the
 *     schema with E2E_SCHEMA; override the whole URL with E2E_DATABASE_URL.
 *  2. NODE_ENV=test.
 *  3. No social sign-in providers and no Redis, whatever a developer's local
 *     apps/api/.env says — specs must never reach Google/GitHub/Microsoft,
 *     and sign-in emails fall back to "copy the link" deterministically.
 *     (Real env vars take precedence over .env in @nestjs/config.)
 */
process.env.NODE_ENV = process.env.NODE_ENV || "test";
for (const key of ["GOOGLE_CLIENT_ID", "MICROSOFT_CLIENT_ID", "GITHUB_CLIENT_ID", "REDIS_URL"]) {
  process.env[key] = "";
}
process.env.WEB_APP_URL = "http://web.e2e.test";

if (process.env.E2E_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.E2E_DATABASE_URL;
} else {
  const schema = process.env.E2E_SCHEMA || "e2e";
  const base = process.env.DATABASE_URL || "postgresql://opsdesk:opsdesk@localhost:5432/opsdesk";
  const url = new URL(base);
  url.searchParams.set("schema", schema);
  process.env.DATABASE_URL = url.toString();
}
