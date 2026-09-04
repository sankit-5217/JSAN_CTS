# Operational runbooks

Runbooks for the platform's own operation (spec §26). One section per
scenario; each says when to use it, exact commands, and how to verify
success — not just a description of the problem.

## Database restore

**When to use this**: Postgres data loss/corruption, a bad migration that
needs rolling back to a known-good state, or standing up a staging/UAT
instance from a production-like snapshot (spec §20, UAT/STAGING environment
rule: "production-like configuration; masked/synthetic data unless
approved" — never restore a real production dump into UAT with real
customer data un-masked).

**Prerequisites**: `pg_dump`/`pg_restore`/`createdb`/`dropdb` on `PATH`
(bundled with any Postgres client install — see `psql --version` to
confirm), and `DATABASE_URL` pointing at the *target* server (not
necessarily the one being restored from).

**Backup** (also runnable on a schedule — spec §18: "Automated DB ...
backup with periodic restore test"):

```bash
DATABASE_URL=postgresql://opsdesk:opsdesk@localhost:5432/opsdesk?schema=public \
  ./infra/scripts/backup-db.sh ./backups
```

Produces `./backups/opsdesk-<UTC timestamp>.dump` (custom format — see
`infra/scripts/backup-db.sh` for why: compressed, and restorable
selectively, not just as a whole database).

**Restore**, into a *new* database (never restore over a live one in place
— always stand up the restored copy, verify it, then cut over):

```bash
createdb -h <host> -U opsdesk opsdesk_restored
pg_restore -h <host> -U opsdesk -d opsdesk_restored --no-owner --no-privileges \
  ./backups/opsdesk-<timestamp>.dump
```

**Verify the restore actually worked** before trusting it — row counts on
a handful of core tables, compared against the source database:

```sql
SELECT 'sites', count(*) FROM sites
UNION ALL SELECT 'incidents', count(*) FROM incidents
UNION ALL SELECT 'configuration_items', count(*) FROM configuration_items
UNION ALL SELECT 'audit_events', count(*) FROM audit_events;
```

Run the same query against both the source and the restored database; the
numbers must match. For a production drill, also spot-check that a known
incident's full timeline (`GET /incidents/:id/events`) renders identically
against the restored copy — a row-count match alone doesn't prove
relationships (CI ↔ incident ↔ audit event) survived intact.

**Last actually executed**: 2026-09-04 (Sprint 12 hardening pass) — full
round trip against the local dev database (backup → restore into a scratch
DB → row-count compare on sites/incidents/configuration_items/audit_events,
all matched exactly → scratch DB dropped). Re-run this drill periodically
per §18, not just once.

**Known gap**: this covers Postgres only. Object storage (S3/MinIO
attachments) backup/restore is not yet scripted — no environment in this
project has had a persistent MinIO instance running long enough to design
and test that drill against (a gap flagged since Sprint 5's attachment
work). Add it here once that's true somewhere.

## Redis failure

*Placeholder — not yet written.* Redis backs BullMQ (SLA timer relay,
notification delivery, alert correlation jobs — `apps/worker`). A restart
runbook needs input from whoever owns the worker's queue configuration on
what's safely re-enqueued vs. what's lost on a Redis restart.

## Collector reinstall

*Placeholder — not yet written.* Covers `apps/collector`, the on-site
agent that talks to iDRAC/iLO/SNMP and pushes health data outbound over
TLS (spec §11). Needs the collector owner's input on its actual deployment
mechanism (systemd unit? Windows service? container?) before a reinstall
procedure can be written accurately rather than guessed.

## Certificate rotation

*Placeholder — not yet written.* Covers TLS/mTLS certs between the
collector and the central API (spec §11/§18). Depends on how certs are
actually issued/stored in each environment — not yet decided.

## Vendor API credential rotation

*Placeholder — not yet written.* Covers Dell/HPE/vendor-portal API tokens
(`integrations/dell-ome`, `integrations/hpe-ilo`, `vendors` module).
Needs input from whoever owns the vendor adapter credential storage on the
actual rotation mechanism per vendor.
