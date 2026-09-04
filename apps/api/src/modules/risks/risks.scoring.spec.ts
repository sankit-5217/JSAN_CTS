import {
  computeRiskScore,
  deriveRiskView,
  scoreRangeForSeverity,
  severityForScore,
} from "./risks.scoring";

describe("computeRiskScore", () => {
  it("multiplies likelihood by impact", () => {
    expect(computeRiskScore(3, 4)).toBe(12);
    expect(computeRiskScore(1, 1)).toBe(1);
    expect(computeRiskScore(5, 5)).toBe(25);
  });

  it("rejects values outside the 1–5 scale", () => {
    expect(() => computeRiskScore(0, 3)).toThrow(RangeError);
    expect(() => computeRiskScore(3, 6)).toThrow(RangeError);
    expect(() => computeRiskScore(2.5, 3)).toThrow(RangeError);
  });
});

describe("severityForScore", () => {
  it.each([
    [1, "LOW"],
    [4, "LOW"],
    [5, "MEDIUM"],
    [9, "MEDIUM"],
    [10, "HIGH"],
    [14, "HIGH"],
    [15, "CRITICAL"],
    [25, "CRITICAL"],
  ])("scores %i as %s", (score, expected) => {
    expect(severityForScore(score)).toBe(expected);
  });
});

describe("scoreRangeForSeverity", () => {
  it("round-trips with severityForScore", () => {
    for (const severity of ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const) {
      const { min, max } = scoreRangeForSeverity(severity);
      expect(severityForScore(min)).toBe(severity);
      expect(severityForScore(max)).toBe(severity);
    }
  });
});

describe("deriveRiskView", () => {
  const NOW = new Date("2026-09-05T00:00:00.000Z");

  it("flags overdue when past the due date and not CLOSED", () => {
    const view = deriveRiskView(
      { score: 12, status: "OPEN", dueDate: new Date("2026-09-01T00:00:00.000Z") },
      NOW,
    );
    expect(view).toEqual({ severity: "HIGH", overdue: true });
  });

  it("is not overdue once CLOSED", () => {
    const view = deriveRiskView(
      { score: 12, status: "CLOSED", dueDate: new Date("2026-09-01T00:00:00.000Z") },
      NOW,
    );
    expect(view.overdue).toBe(false);
  });

  it("is not overdue with no due date", () => {
    expect(deriveRiskView({ score: 3, status: "OPEN", dueDate: null }, NOW).overdue).toBe(false);
  });
});
