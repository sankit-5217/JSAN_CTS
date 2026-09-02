import { Module } from "@nestjs/common";

/**
 * Owner: Dev B (Integrations, Hardware & Governance).
 * Owns: risk register, BCP records (spec §10.15, §12).
 * Must not own: ticket state.
 *
 * TODO (Sprint 11): risks (likelihood/impact/score/mitigation/owner/due
 * date/status), bcp_plans (RTO/RPO/alternate site/test dates). Never label
 * the operating model "zero downtime" where physical redundancy is absent.
 */
@Module({})
export class RisksModule {}
