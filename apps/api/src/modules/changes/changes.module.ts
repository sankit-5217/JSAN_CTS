import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ChangesController } from "./changes.controller";
import { ChangesService } from "./changes.service";

/**
 * Owner: Dev B (Integrations, Hardware & Governance).
 * Owns: change workflow and maintenance windows (spec §10.6, §12).
 * Must not own: monitoring storage.
 *
 * Sprint 11 (done): change CRUD; STANDARD/NORMAL/EMERGENCY types; approval
 * (single approver, 409 if re-approved, rejected after window end); status
 * derived from approver/window/outcome (no status column); plan+window
 * editable only before work starts; outcome / emergency PIR capture with a
 * pirOverdue flag; GET /changes/maintenance/active as the alert-suppression feed.
 * Every mutation writes an AuditEvent in the same transaction as the write
 * (CHANGE_CREATED / CHANGE_APPROVED / CHANGE_UPDATED via AuditService).
 * Per-CI window scoping (done): Change.affectedCiIds (empty = site-wide);
 * GET /changes/maintenance/active?ciId=… answers whether a specific CI is
 * under maintenance right now.
 */
@Module({
  imports: [AuthModule],
  controllers: [ChangesController],
  providers: [ChangesService],
  exports: [ChangesService],
})
export class ChangesModule {}
