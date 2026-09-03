import { deriveKnowledgeView, isPublished } from "./knowledge.status";
import type { KnowledgeStatusInput } from "./knowledge.status";

const NOW = new Date("2026-09-05T12:00:00.000Z");

function article(overrides: Partial<KnowledgeStatusInput> = {}): KnowledgeStatusInput {
  return {
    approvalState: "APPROVED",
    reviewDueAt: new Date("2027-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

describe("deriveKnowledgeView", () => {
  it("a DRAFT article is never authoritative", () => {
    const view = deriveKnowledgeView(article({ approvalState: "DRAFT", reviewDueAt: null }), NOW);
    expect(view.authoritative).toBe(false);
    expect(view.reviewOverdue).toBe(false);
  });

  it("an APPROVED article with a future review date is authoritative", () => {
    expect(deriveKnowledgeView(article(), NOW).authoritative).toBe(true);
  });

  it("an APPROVED article with no review date is authoritative", () => {
    expect(deriveKnowledgeView(article({ reviewDueAt: null }), NOW).authoritative).toBe(true);
  });

  it("an APPROVED article past its review date is not authoritative and flagged overdue", () => {
    const view = deriveKnowledgeView(
      article({ reviewDueAt: new Date("2026-01-01T00:00:00.000Z") }),
      NOW,
    );
    expect(view.authoritative).toBe(false);
    expect(view.reviewOverdue).toBe(true);
  });

  it("a DRAFT article past a stale review date is not reported as review-overdue", () => {
    const view = deriveKnowledgeView(
      article({ approvalState: "DRAFT", reviewDueAt: new Date("2026-01-01T00:00:00.000Z") }),
      NOW,
    );
    expect(view.reviewOverdue).toBe(false);
    expect(view.authoritative).toBe(false);
  });
});

describe("isPublished", () => {
  it("is true only for APPROVED", () => {
    expect(isPublished("APPROVED")).toBe(true);
    expect(isPublished("DRAFT")).toBe(false);
  });
});
