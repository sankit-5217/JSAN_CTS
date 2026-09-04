import { deriveBcpReadiness } from "./bcp.readiness";

const NOW = new Date("2026-09-04T12:00:00.000Z");

describe("deriveBcpReadiness", () => {
  it("is UNTESTED when there is no test on record", () => {
    expect(deriveBcpReadiness({ lastTestedAt: null, nextTestDueAt: null }, NOW)).toEqual({
      readiness: "UNTESTED",
      neverTested: true,
      testOverdue: false,
    });
  });

  it("stays UNTESTED even if a next test date has passed", () => {
    const view = deriveBcpReadiness(
      { lastTestedAt: null, nextTestDueAt: new Date("2026-01-01T00:00:00.000Z") },
      NOW,
    );
    expect(view.readiness).toBe("UNTESTED");
    expect(view.testOverdue).toBe(true);
  });

  it("is DUE when tested before but the next test date has passed", () => {
    expect(
      deriveBcpReadiness(
        {
          lastTestedAt: new Date("2026-03-01T00:00:00.000Z"),
          nextTestDueAt: new Date("2026-09-01T00:00:00.000Z"),
        },
        NOW,
      ).readiness,
    ).toBe("DUE");
  });

  it("is READY when tested and the next test is still in the future", () => {
    expect(
      deriveBcpReadiness(
        {
          lastTestedAt: new Date("2026-08-01T00:00:00.000Z"),
          nextTestDueAt: new Date("2027-02-01T00:00:00.000Z"),
        },
        NOW,
      ).readiness,
    ).toBe("READY");
  });

  it("is READY when tested and nothing is scheduled", () => {
    expect(
      deriveBcpReadiness(
        { lastTestedAt: new Date("2026-08-01T00:00:00.000Z"), nextTestDueAt: null },
        NOW,
      ),
    ).toEqual({ readiness: "READY", neverTested: false, testOverdue: false });
  });
});
