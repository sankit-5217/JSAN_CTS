import type { ApprovalState } from "./knowledge.constants";

/** The KnowledgeArticle fields the read-time view is derived from. */
export interface KnowledgeStatusInput {
  approvalState: ApprovalState | string;
  reviewDueAt: Date | null;
}

/** Derived read-time view of an article. */
export interface KnowledgeView {
  /** APPROVED and its review is not past due. The only flag a consumer
   *  (e.g. an incident attaching a runbook) should trust. */
  authoritative: boolean;
  /** APPROVED but reviewDueAt has passed — still readable, no longer trusted. */
  reviewOverdue: boolean;
}

/**
 * Compute whether an article may be presented as an authoritative runbook.
 * Draft / unapproved procedures are never authoritative (spec §10.14); an
 * approved article whose review date has passed also stops being authoritative
 * until someone re-reviews it.
 */
export function deriveKnowledgeView(
  article: KnowledgeStatusInput,
  now: Date = new Date(),
): KnowledgeView {
  const approved = article.approvalState === "APPROVED";
  const reviewOverdue =
    approved && article.reviewDueAt !== null && article.reviewDueAt.getTime() < now.getTime();
  return {
    authoritative: approved && !reviewOverdue,
    reviewOverdue,
  };
}

/** Is the article currently published (approved)? */
export function isPublished(approvalState: ApprovalState | string): boolean {
  return approvalState === "APPROVED";
}
