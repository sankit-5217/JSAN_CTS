import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { IncidentsController } from "./incidents.controller";
import { IncidentsService } from "./incidents.service";

/**
 * Owner: Dev A (Platform & Ticketing Core).
 * Owns: incident state machine, assignments, comments (spec §12, §15).
 * Must not own: vendor polling.
 *
 * State transitions never happen via PATCH — only POST /incidents/:id/transition,
 * added in Sprint 4 step 3 (spec §15).
 */
@Module({
  imports: [AuthModule],
  controllers: [IncidentsController],
  providers: [IncidentsService],
  exports: [IncidentsService],
})
export class IncidentsModule {}
