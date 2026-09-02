import { Module } from "@nestjs/common";

/**
 * Owner: Dev B (Integrations, Hardware & Governance).
 * Owns: vendors, warranties, cases, RMA (spec §10.13, §12).
 * Must not own: monitoring metrics.
 *
 * TODO (Sprint 11): vendor_case CRUD, dispatch_status lifecycle, append-only
 * vendor_updates, linked_incident_id, replacement_part tracking.
 */
@Module({})
export class VendorsModule {}
