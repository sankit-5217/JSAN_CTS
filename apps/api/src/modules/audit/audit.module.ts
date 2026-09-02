import { Global, Module } from "@nestjs/common";
import { AuditService } from "./audit.service";

/**
 * Owner: Dev A (Platform & Ticketing Core).
 * Owns: append-only audit records (spec §12).
 * Must not own: business entity edits.
 *
 * @Global (same pattern as PrismaModule) so every other module can
 * inject AuditService without importing this module explicitly — every
 * module needs it, per the "audit everything" rule.
 *
 * TODO (later sprint): GET /api/v1/audit read endpoint for authorized
 * audit search (spec §14.1) — write-side only for now.
 */
@Global()
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
