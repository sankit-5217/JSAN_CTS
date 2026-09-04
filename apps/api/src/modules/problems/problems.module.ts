import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ChangesModule } from "../changes/changes.module";
import { IncidentsModule } from "../incidents/incidents.module";
import { ProblemsController } from "./problems.controller";
import { ProblemsService } from "./problems.service";

/**
 * Owner: Dev B (Integrations, Hardware & Governance).
 * Owns: problem / RCA records, action items, and links to related
 * incidents / changes (spec §10.5, §12).
 * Must not own: incident creation or state.
 *
 * A problem is opened for repeated / major incidents that need formal RCA.
 * It captures symptoms, known error, root cause, corrective + preventive
 * action, owner and due date; tracks action items to completion; and links
 * (never edits) the related incidents and changes. Closing an incident never
 * touches a problem. Every mutation writes an AuditEvent in the same
 * transaction as the write (PROBLEM_CREATED / _UPDATED / _STATUS_CHANGED /
 * _ACTION_ITEM_ADDED / _ACTION_ITEM_COMPLETED / _LINKED / _UNLINKED).
 *
 * IncidentsModule / ChangesModule are imported only for their exported
 * services — link targets are validated via IncidentsService.findOne /
 * ChangesService.getOne, never by querying their tables.
 */
@Module({
  imports: [AuthModule, IncidentsModule, ChangesModule],
  controllers: [ProblemsController],
  providers: [ProblemsService],
  exports: [ProblemsService],
})
export class ProblemsModule {}
