/**
 * Guard against a misconfigured run wiping real data: every e2e spec TRUNCATEs
 * its schema, so refuse to start unless DATABASE_URL is clearly pointed at an
 * isolated e2e schema (never `public`). `test/env.js` sets this up; this is the
 * seatbelt.
 */
const url = process.env.DATABASE_URL ?? "";
const schema = new URL(url).searchParams.get("schema");

if (!schema || schema === "public") {
  throw new Error(
    `e2e refuses to run against schema "${schema ?? "(none)"}" — set E2E_SCHEMA / E2E_DATABASE_URL to an isolated schema`,
  );
}

jest.setTimeout(30_000);
