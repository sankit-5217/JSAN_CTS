import { Global, Module } from "@nestjs/common";
import { AuditController } from "./audit.controller";
import { AuditService } from "./audit.service";

/**
 * Owner: Dev A (Platform & Ticketing Core).
 * Owns: append-only audit records (spec §12).
 * Must not own: business entity edits.
 *
 * @Global (same pattern as PrismaModule) so every other module can
 * inject AuditService without importing this module explicitly — every
 * module needs it, per the "audit everything" rule.
 */
@Global()
@Module({
  controllers: [AuditController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
