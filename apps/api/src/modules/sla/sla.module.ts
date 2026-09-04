import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { AuthModule } from "../auth/auth.module";
import { SitesModule } from "../sites/sites.module";
import { SlaController } from "./sla.controller";
import { SlaEscalationScanner } from "./sla-escalation.scanner";
import { SlaService } from "./sla.service";
import { SlaTimersPublisher } from "./sla-timers.publisher";

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
 * Sprint 6 step 3 added the incident lifecycle hooks (start/ack/resolve/
 * pause/resume/priority-change). Step 4 adds the escalation scan:
 * `ScheduleModule.forRoot()` is imported here (the only consumer of
 * @nestjs/schedule in this app) rather than in AppModule, since a second
 * `.forRoot()` import anywhere else in the tree would double-register it.
 */
@Module({
  imports: [AuthModule, SitesModule, ScheduleModule.forRoot()],
  controllers: [SlaController],
  providers: [SlaService, SlaTimersPublisher, SlaEscalationScanner],
  exports: [SlaService],
})
export class SlaModule {}
