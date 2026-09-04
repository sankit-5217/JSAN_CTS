import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { MonitoringController } from "./monitoring.controller";
import { MonitoringService } from "./monitoring.service";

/**
 * Owner: Dev B (Integrations, Hardware & Governance).
 * Owns: the current HealthSnapshot per CI — the normalized hardware-health
 * rollup produced by the redfish / dell-ome / hpe-ilo adapters and delivered by
 * the site collector (spec §10.12, §14.x).
 * Must not own: raw time-series / per-sensor telemetry (stays in the monitoring
 * platform); ticket state.
 *
 * POST /monitoring/health-snapshots — batch upsert (unknown CI rejected
 * per-item), service-account JWT + an ingest role; audit event per snapshot.
 * GET /monitoring/health-snapshots/:ciCode — current snapshot for a CI.
 * POST /monitoring/collector-heartbeat — site collector liveness ping (spec §26),
 * stored as an append-only COLLECTOR_HEARTBEAT audit event per site.
 * TODO: if Dev A treats HealthSnapshot as cmdb's to write, the upsert moves
 * behind CmdbService — the ingest contract stays.
 */
@Module({
  imports: [AuthModule],
  controllers: [MonitoringController],
  providers: [MonitoringService],
  exports: [MonitoringService],
})
export class MonitoringModule {}
