/**
 * Runs before the test framework and before any module (PrismaClient,
 * @nestjs/config) reads the environment. Two jobs:
 *
 *  1. Point DATABASE_URL at an isolated `e2e` schema in the dev database, so an
 *     e2e run can TRUNCATE freely without touching `public`. Override the
 *     schema with E2E_SCHEMA; override the whole URL with E2E_DATABASE_URL.
 *  2. NODE_ENV=test — not "production", so POST /auth/dev-login stays enabled.
 */
process.env.NODE_ENV = process.env.NODE_ENV || "test";

if (process.env.E2E_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.E2E_DATABASE_URL;
} else {
  const schema = process.env.E2E_SCHEMA || "e2e";
  const base = process.env.DATABASE_URL || "postgresql://opsdesk:opsdesk@localhost:5432/opsdesk";
  const url = new URL(base);
  url.searchParams.set("schema", schema);
  process.env.DATABASE_URL = url.toString();
}
