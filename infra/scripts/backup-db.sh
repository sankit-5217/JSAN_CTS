#!/usr/bin/env bash
# Backs up the OpsDesk Postgres database (spec §18: "Automated DB + object
# storage backup with periodic restore test"; this script covers the DB
# half — object storage/MinIO backup is a follow-up once MinIO is running
# in every environment that needs it, see docs/runbooks/README.md).
#
# Usage:
#   ./infra/scripts/backup-db.sh [output-dir]
#
# Reads DATABASE_URL from the environment (same variable apps/api and the
# worker already use). Requires pg_dump on PATH — see docs/runbooks/README.md
# for how to restore what this produces.
set -euo pipefail

OUTPUT_DIR="${1:-./backups}"
mkdir -p "$OUTPUT_DIR"

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL is not set — export it (see apps/api/.env) before running this script." >&2
  exit 1
fi

TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUTPUT_FILE="$OUTPUT_DIR/opsdesk-${TIMESTAMP}.dump"

# Prisma's connection string carries a `?schema=public` query param that
# pg_dump doesn't understand (it's a Prisma-only convention, not libpq) —
# strip any query string before handing the URL to pg_dump. A full dump
# already includes every schema in the database by default.
PG_DUMP_URL="${DATABASE_URL%%\?*}"

# Custom format (-Fc): compressed, and restorable with pg_restore either as
# a whole DB or selectively (single table/schema) — plain SQL dumps can't
# do the latter.
pg_dump --format=custom --file="$OUTPUT_FILE" --dbname="$PG_DUMP_URL"

echo "Backup written to $OUTPUT_FILE"
