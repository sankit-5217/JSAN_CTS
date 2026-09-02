import { Module } from "@nestjs/common";

/**
 * Owner: Dev B (Integrations, Hardware & Governance).
 * Owns: normalized alerts, fingerprints, correlation (spec §10.9-10.10, §12).
 * Must not own: raw time-series storage (that stays in Zabbix/Prometheus).
 *
 * TODO (Sprint 8): POST /alerts/ingest, fingerprint = hash(site + CI + alert
 * type + component), dedup against OPEN incidents, flapping detection,
 * maintenance-window suppression. Must be idempotent via external_event_id.
 */
@Module({})
export class AlertsModule {}
