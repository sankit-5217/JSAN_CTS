import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ChangesModule } from "../changes/changes.module";
import { IncidentsModule } from "../incidents/incidents.module";
import { AlertRulesController } from "./alert-rules.controller";
import { AlertRulesService } from "./alert-rules.service";
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
 * Sprint 9 (done): POST /alerts/sources/{zabbix,alertmanager,snmp} — normalize
 * native payloads via @cts-dc-opsdesk/{zabbix,prometheus,snmp}-adapter then
 * funnel into ingest(); per-event failures reported, never fatal. All ingest
 * routes require a service-account JWT with an ALERT_INGEST role.
 * Maintenance suppression (spec §10.10 rule 5, done): ingest() flags
 * suppressedByMaintenance when the linked CI is in MAINTENANCE lifecycle OR is
 * covered by an approved change window right now (ChangesService, best-effort).
 * When the active rule's suppressAutoTicketDuringMaintenance is set, a suppressed
 * alert is still recorded but skips correlation and the NOC page; otherwise it is
 * only labelled expected.
 * ingest() writes an AuditEvent in the same transaction as the write — ALERT_RAISED
 * on first sighting, ALERT_STATE_CHANGED on a lifecycle move; a plain dedup /
 * lastSeenAt bump is deliberately not audited (ingestion is high-volume).
 * Correlation (done): a non-RECOVERED alert on a CI that already has a still-open
 * incident is linked to it (Alert.correlatedIncidentId + an ALERT_LINKED timeline
 * event), via IncidentsService — link-only, never opens or transitions a ticket.
 * Config (done): the `alert_rules` table (AlertRulesService, /alert-rules CRUD)
 * holds the flapping threshold + window, NOC-paging severities, the
 * auto-correlate toggle and the maintenance-suppression mode. A rule may be
 * scoped by siteId / alertType; ingest() resolves the most specific active
 * match (site+type > site > type > global) behind a ~30s cache, code defaults
 * until a row is seeded (spec §10.10, "config over hard-code").
 */
@Module({
  imports: [AuthModule, IncidentsModule, ChangesModule],
  controllers: [AlertsController, AlertRulesController],
  providers: [AlertsService, AlertRulesService],
  exports: [AlertsService, AlertRulesService],
})
export class AlertsModule {}
