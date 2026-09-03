import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { VendorCasesController } from "./vendor-cases.controller";
import { VendorsController } from "./vendors.controller";
import { VendorsService } from "./vendors.service";

/**
 * Owner: Dev B (Integrations, Hardware & Governance).
 * Owns: vendors, warranties, cases, RMA (spec §10.13, §12).
 * Must not own: monitoring metrics.
 *
 * Sprint 11 (done): vendor CRUD; vendor_case open/list/get; backend-enforced
 * dispatch_status lifecycle (REQUESTED -> APPROVED -> SHIPPED -> DELIVERED ->
 * INSTALLED, plus RETURNED); acknowledge + close with outcome; append-only
 * vendor_case_updates; linked_incident_id / ci_id existence checks. Every
 * mutation writes an AuditEvent in the same transaction as the write
 * (VENDOR_REGISTERED / VENDOR_CASE_OPENED / _UPDATED / _CLOSED / _NOTE_ADDED).
 * TODO: actorId/correlationId populate once the auth guard is on the controllers;
 * warranty lifecycle stays with the cmdb module (Dev A) per the schema.
 */
@Module({
  imports: [AuthModule],
  controllers: [VendorsController, VendorCasesController],
  providers: [VendorsService],
  exports: [VendorsService],
})
export class VendorsModule {}
