import { Module } from "@nestjs/common";
import { AlertsController } from "./alerts.controller";
import { AlertsService } from "./alerts.service";

/**
 * Owner: Dev B (Integrations, Hardware & Governance).
 * Owns: normalized alerts, fingerprints, correlation (spec §10.9-10.10, §12).
 * Must not own: raw time-series storage (that stays in Zabbix/Prometheus).
 *
 * Sprint 8 (done): POST /alerts/ingest — idempotent on (source, externalEventId),
 * stable fingerprint = sha256(site + CI + alert type + component), OPEN/ACK/
 * RECOVERED state reduction, flapping signal, graceful unresolved site/CI;
 * GET /alerts + GET /alerts/:id read models.
 * Sprint 9 (done): POST /alerts/sources/zabbix and /alerts/sources/alertmanager —
 * normalize native webhook payloads via @cts-dc-opsdesk/{zabbix,prometheus}-adapter
 * then funnel into ingest(); per-event failures reported, never fatal.
 * Sprint 11 (partial): ingest() flags suppressedByMaintenance when the linked CI
 * is in MAINTENANCE lifecycle. Broader change-window suppression (changes module,
 * GET /changes/maintenance/active) is layered on by the worker at correlation time.
 * ingest() writes an AuditEvent in the same transaction as the write — ALERT_RAISED
 * on first sighting, ALERT_STATE_CHANGED on a lifecycle move; a plain dedup /
 * lastSeenAt bump is deliberately not audited (ingestion is high-volume).
 * TODO: correlate to OPEN incidents once the incidents module (Dev A) lands; move
 * flapping thresholds into an alert_rules config table (config-over-hardcode).
 */
@Module({
  controllers: [AlertsController],
  providers: [AlertsService],
  exports: [AlertsService],
})
export class AlertsModule {}
