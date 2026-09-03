import { Module } from "@nestjs/common";
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
 * TODO: actorId/correlationId populate once the auth guard is on the controller;
 * per-CI window scoping needs a Change.affectedCiIds schema field (coordinate
 * with Dev A) — until then alert suppression keys off ci.lifecycleStatus.
 */
@Module({
  controllers: [ChangesController],
  providers: [ChangesService],
  exports: [ChangesService],
})
export class ChangesModule {}
