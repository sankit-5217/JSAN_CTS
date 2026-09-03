/**
 * Knowledge-base vocabulary. `ApprovalState` matches the string stored in
 * `knowledge_articles.approval_state`. There is no version-history table — the
 * schema keeps a single `version` counter on the row, so an edit to the article
 * body bumps `version` and drops the article back to DRAFT (an approved runbook
 * that changed is no longer authoritative until it is re-approved). Whether an
 * article may be shown as an authoritative runbook is *derived* at read time
 * from approvalState + reviewDueAt — see `knowledge.status.ts`.
 */
export type ApprovalState = "DRAFT" | "APPROVED";
export const APPROVAL_STATES: readonly ApprovalState[] = ["DRAFT", "APPROVED"];

/** Named read-side views for `GET /knowledge` (avoids boolean query params). */
export type KnowledgeView = "authoritative" | "review-overdue";
export const KNOWLEDGE_VIEWS: readonly KnowledgeView[] = ["authoritative", "review-overdue"];
