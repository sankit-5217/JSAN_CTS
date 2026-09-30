#!/usr/bin/env bash
# Backs up the OpsDesk attachments bucket (spec §18: "Automated DB + object
# storage backup with periodic restore test"; this script covers the object
# storage half — see infra/scripts/backup-db.sh for the Postgres half, and
# docs/runbooks/README.md for how to restore what this produces).
#
# Usage:
#   ./infra/scripts/backup-minio.sh [output-dir]
#
# Reads S3_ENDPOINT/S3_ACCESS_KEY/S3_SECRET_KEY/S3_BUCKET from the
# environment (the same variables apps/api's StorageService already uses —
# see apps/api/.env). Requires the MinIO client (`mc`) on PATH.
set -euo pipefail

OUTPUT_DIR="${1:-./backups}"
mkdir -p "$OUTPUT_DIR"

for var in S3_ENDPOINT S3_ACCESS_KEY S3_SECRET_KEY S3_BUCKET; do
  if [ -z "${!var:-}" ]; then
    echo "$var is not set — export it (see apps/api/.env) before running this script." >&2
    exit 1
  fi
done

TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUTPUT_PATH="$OUTPUT_DIR/opsdesk-attachments-${TIMESTAMP}"

# A private alias (not the default `local`/`~/.mc/config.json` one a
# developer's shell may already have) so this script never depends on -- or
# clobbers -- an interactively configured `mc` alias.
ALIAS="opsdesk-backup-script"
mc alias set "$ALIAS" "$S3_ENDPOINT" "$S3_ACCESS_KEY" "$S3_SECRET_KEY" >/dev/null

mc mirror "$ALIAS/$S3_BUCKET" "$OUTPUT_PATH"

mc alias remove "$ALIAS" >/dev/null

echo "Backup written to $OUTPUT_PATH"
