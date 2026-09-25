/**
 * Runs before the test framework and before any module (PrismaClient,
 * @nestjs/config) reads the environment. Two jobs:
 *
 *  1. Point DATABASE_URL at an isolated `e2e` schema in the dev database, so an
 *     e2e run can TRUNCATE freely without touching `public`. Override the
 *     schema with E2E_SCHEMA; override the whole URL with E2E_DATABASE_URL.
 *  2. NODE_ENV=test — not "production", so POST /auth/dev-login stays enabled.
 *  3. SSO off, whatever a developer's local apps/api/.env says — the SSO
 *     specs assert the disabled behaviour and must not reach a real IdP.
 *     (Real env vars take precedence over .env in @nestjs/config.)
 */
process.env.NODE_ENV = process.env.NODE_ENV || "test";
process.env.OIDC_ENABLED = "false";

if (process.env.E2E_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.E2E_DATABASE_URL;
} else {
  const schema = process.env.E2E_SCHEMA || "e2e";
  const base = process.env.DATABASE_URL || "postgresql://opsdesk:opsdesk@localhost:5432/opsdesk";
  const url = new URL(base);
  url.searchParams.set("schema", schema);
  process.env.DATABASE_URL = url.toString();
}
