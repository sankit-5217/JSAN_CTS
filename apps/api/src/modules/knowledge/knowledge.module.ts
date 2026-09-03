import { Module } from "@nestjs/common";
import { KnowledgeController } from "./knowledge.controller";
import { KnowledgeService } from "./knowledge.service";

/**
 * Owner: Dev B (Integrations, Hardware & Governance).
 * Owns: SOPs/runbooks, approvals, versions (spec §10.14, §12).
 * Must not own: incident creation.
 *
 * Sprint 11 (done): article CRUD (starts DRAFT); editing title/body bumps the
 * `version` counter and reverts to DRAFT (no version-history table in the
 * schema); approve → APPROVED with a mandatory future reviewDueAt, owner cannot
 * self-approve; unpublish → DRAFT with a reason; `authoritative` / `reviewOverdue`
 * derived from approvalState + reviewDueAt (never stored); `view=authoritative`
 * / `view=review-overdue` read filters; requireAuthoritative() cross-module guard
 * so incidents/changes can only link a trusted runbook. Every mutation writes an
 * AuditEvent in the same transaction as the write (KNOWLEDGE_ARTICLE_CREATED /
 * _UPDATED / _APPROVED / _UNPUBLISHED via AuditService).
 * TODO: actorId/correlationId populate once the auth guard is on the controller;
 * full-text search belongs in OpenSearch, not `body LIKE` (spec §10.14).
 */
@Module({
  controllers: [KnowledgeController],
  providers: [KnowledgeService],
  exports: [KnowledgeService],
})
export class KnowledgeModule {}
