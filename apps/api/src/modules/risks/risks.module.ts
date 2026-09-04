import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { BcpController } from "./bcp.controller";
import { BcpService } from "./bcp.service";
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
 * (AuditService) with the real actorId + correlationId from the request.
 * Writes require SUPER_ADMIN / DELIVERY_OPS_MANAGER / INFRASTRUCTURE_LEAD.
 *
 * BCP plans (done): `bcp_plans` table + BcpService / BcpController
 * (/bcp-plans). A plan covers one site XOR one named service; carries the
 * recovery strategy, alternate site, RTO/RPO, contacts and test cadence.
 * "Readiness" (untested / test overdue / ready) is derived at read time from
 * the test dates. POST /bcp-plans/:id/tests logs a test (spec §10.15 /
 * §10.16 "test evidence"). Every mutation audits in the write transaction
 * (BCP_PLAN_CREATED / _UPDATED / _TESTED).
 */
@Module({
  imports: [AuthModule],
  controllers: [RisksController, BcpController],
  providers: [RisksService, BcpService],
  exports: [RisksService, BcpService],
})
export class RisksModule {}
