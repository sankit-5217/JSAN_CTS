import { Module } from "@nestjs/common";
import { RisksController } from "./risks.controller";
import { RisksService } from "./risks.service";

/**
 * Owner: Dev B (Integrations, Hardware & Governance).
 * Owns: risk register, BCP records (spec §10.15, §12).
 * Must not own: ticket state.
 *
 * Sprint 11 (done): risk register CRUD against the thin `risks` schema.
 * `score` = likelihood × impact computed server-side (never client-set);
 * `severity` band (LOW/MEDIUM/HIGH/CRITICAL) and `overdue` derived at read
 * time; status lifecycle OPEN → MITIGATING → ACCEPTED → CLOSED (any state
 * re-openable) via a transition guard, with mitigation text mandatory for
 * MITIGATING / ACCEPTED; list filters by status, severity, site, owner and an
 * `overdue` view. Every mutation writes an audit event in the same transaction
 * (AuditService) — actorId/correlationId wire in with the auth guard.
 * TODO: BCP plans need a `bcp_plans` table (RTO/RPO/alternate site/test dates)
 * before that half of the module can be built.
 */
@Module({
  controllers: [RisksController],
  providers: [RisksService],
  exports: [RisksService],
})
export class RisksModule {}
