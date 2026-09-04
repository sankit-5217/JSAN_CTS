import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { VendorCasesController } from "./vendor-cases.controller";
import { VendorsController } from "./vendors.controller";
import { VendorsService } from "./vendors.service";
import { WarrantyController } from "./warranty.controller";
import { warrantyProvidersProvider } from "./warranty.providers";
import { WarrantyResyncService } from "./warranty-resync.service";

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
 *
 * Warranty resync (spec §10.13): this module owns the append-only `Warranty`
 * table (spec §12). `WarrantyResyncService` looks coverage up through the
 * read-only warranty-adapter providers and appends a new row + a
 * WARRANTY_REFRESHED audit event only when coverage changed. `apps/worker`
 * schedules it nightly over HTTP against POST /vendors/warranty-sync.
 */
@Module({
  imports: [AuthModule],
  controllers: [VendorsController, VendorCasesController, WarrantyController],
  providers: [VendorsService, WarrantyResyncService, warrantyProvidersProvider],
  exports: [VendorsService, WarrantyResyncService],
})
export class VendorsModule {}
