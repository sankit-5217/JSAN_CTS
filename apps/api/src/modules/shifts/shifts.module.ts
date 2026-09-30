import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ShiftsController } from "./shifts.controller";
import { ShiftsService } from "./shifts.service";
import { ShiftUserChecksListener } from "./shift-user-checks.listener";

/**
 * Owns: recurring weekly engineer shift schedules (EngineerShift) and the
 * live "who's on now" roster computed from them (POST/GET/PATCH /shifts,
 * GET /shifts/live). Must not own: worklogs' actual clocked time, or the
 * SLA module's on-call site contacts (SiteContact.isOnCall) — deliberately
 * not cross-wired into SLA escalation notification; this module is
 * visibility into the schedule, not a second on-call notification path.
 */
@Module({
  imports: [AuthModule],
  controllers: [ShiftsController],
  providers: [ShiftsService, ShiftUserChecksListener],
  exports: [ShiftsService],
})
export class ShiftsModule {}
