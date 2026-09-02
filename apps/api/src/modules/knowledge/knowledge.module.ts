import { Module } from "@nestjs/common";

/**
 * Owner: Dev B (Integrations, Hardware & Governance).
 * Owns: SOPs/runbooks, approvals, versions (spec §10.14, §12).
 * Must not own: incident creation.
 *
 * TODO (Sprint 11): knowledge_articles with versioning, owner, approval
 * state, review date. Draft/unapproved procedures must never render as
 * authoritative runbooks.
 */
@Module({})
export class KnowledgeModule {}
