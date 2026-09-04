import { Module } from "@nestjs/common";
import { StorageModule } from "../../common/storage/storage.module";
import { AuthModule } from "../auth/auth.module";
import { SlaModule } from "../sla/sla.module";
import { IncidentsController } from "./incidents.controller";
import { IncidentsService } from "./incidents.service";

/**
 * Owner: Dev A (Platform & Ticketing Core).
 * Owns: incident state machine, assignments, comments (spec §12, §15).
 * Must not own: vendor polling.
 *
 * State transitions never happen via PATCH — only POST /incidents/:id/transition,
 * added in Sprint 4 step 3 (spec §15).
 *
 * Also owns incident attachments (Sprint 5 step 3) via StorageModule — no
 * dedicated attachments module exists (see worklogs.module.ts's doc comment
 * and the Sprint 5 plan for why).
 *
 * Imports SlaModule (Sprint 6 step 3) to call SlaService's lifecycle hooks
 * on create/transition/update — one-directional (SlaModule never imports
 * this one) to avoid a circular dependency.
 */
@Module({
  imports: [AuthModule, StorageModule, SlaModule],
  controllers: [IncidentsController],
  providers: [IncidentsService],
  exports: [IncidentsService],
})
export class IncidentsModule {}
