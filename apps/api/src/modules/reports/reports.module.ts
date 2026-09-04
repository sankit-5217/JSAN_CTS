import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ReportsController } from "./reports.controller";
import { ReportsService } from "./reports.service";

/**
 * Owner: Dev A (Platform & Ticketing Core).
 * Owns: read models/aggregations (spec §10.16, §12).
 * Must not own: source-of-truth mutations.
 *
 * Sprint 7 adds the Command Center summary (spec §10.1) — global counters,
 * site cards, operational queues. Full spec §10.16 (MTTA/MTTR trends,
 * vendor RMA duration, warranty expiries, risk/BCP readiness) is a later,
 * broader reports sprint — this module keeps growing beyond Sprint 7.
 */
@Module({
  imports: [AuthModule],
  controllers: [ReportsController],
  providers: [ReportsService],
  exports: [ReportsService],
})
export class ReportsModule {}
