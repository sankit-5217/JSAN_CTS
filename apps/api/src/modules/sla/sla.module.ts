import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { SitesModule } from "../sites/sites.module";
import { SlaController } from "./sla.controller";
import { SlaService } from "./sla.service";

/**
 * Owner: Dev A (Platform & Ticketing Core).
 * Owns: SLA policy versions, timers, escalations (spec §10.8, §12).
 * Must not own: UI-only countdowns.
 *
 * Imports SitesModule for support-calendar resolution (`sites` owns that
 * table — see SlaService's class comment) — never IncidentsModule, to
 * avoid a circular dependency; IncidentsModule imports this module and
 * calls SlaService's lifecycle hooks with plain incident fields instead.
 *
 * Sprint 6 step 3 adds the incident lifecycle hooks (start/ack/resolve/
 * pause/resume/priority-change); step 4 adds the escalation scan.
 */
@Module({
  imports: [AuthModule, SitesModule],
  controllers: [SlaController],
  providers: [SlaService],
  exports: [SlaService],
})
export class SlaModule {}
