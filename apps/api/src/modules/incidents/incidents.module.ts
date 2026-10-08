import { Module } from "@nestjs/common";
import { StorageModule } from "../../common/storage/storage.module";
import { AuthModule } from "../auth/auth.module";
import { InboxModule } from "../inbox/inbox.module";
import { SlaModule } from "../sla/sla.module";
import { IncidentCustomerService } from "./incident-customer.service";
import { IncidentsController } from "./incidents.controller";
import { IncidentsService } from "./incidents.service";
import { IncidentUserChecksListener } from "./incident-user-checks.listener";
import { IssueReportingController } from "./issue-reporting.controller";
import { IssueReportingService } from "./issue-reporting.service";

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
 *
 * IncidentCustomerService is the customer side of a ticket: the progress
 * summary (GET :id/progress) and the reporter's "is this fixed?" answer
 * (POST :id/customer-feedback), which notifies the desk but never moves
 * status itself.
 *
 * IssueReportingService owns the "Report an issue" template configuration
 * (pick-list catalog, per-issue-type drafts) and the intake checks a client
 * report goes through before IncidentsService.create — served under
 * /issue-reporting by its own controller.
 */
@Module({
  imports: [AuthModule, StorageModule, SlaModule, InboxModule],
  controllers: [IncidentsController, IssueReportingController],
  providers: [
    IncidentsService,
    IncidentCustomerService,
    IncidentUserChecksListener,
    IssueReportingService,
  ],
  exports: [IncidentsService, IssueReportingService],
})
export class IncidentsModule {}
