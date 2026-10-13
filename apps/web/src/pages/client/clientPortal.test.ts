import { describe, expect, it } from "vitest";
import { describeActivity, describeClock, type PortalTicket } from "./clientPortal";

const since = () => "12m ago";
const activity = (overrides: Partial<PortalTicket["activity"]> = {}): PortalTicket["activity"] => ({
  engineer: "Rahul",
  workingNow: null,
  ...overrides,
});

describe("describeActivity", () => {
  it("leads with a live work session when there is one", () => {
    expect(
      describeActivity(
        activity({ workingNow: { engineer: "Meera", since: "2026-09-30T10:00:00Z" } }),
        since,
      ),
    ).toBe("Meera is working on this now (started 12m ago)");
  });

  it("says nothing about shifts when nobody is working on it right now", () => {
    expect(describeActivity(activity(), since)).toBeNull();
    expect(describeActivity(activity({ engineer: null }), since)).toBeNull();
  });
});

describe("describeClock", () => {
  it("explains a paused clock instead of showing a stale due time", () => {
    expect(describeClock("resolution", { state: "PAUSED", dueAt: null, completedAt: null })).toBe(
      "Clock paused while we wait on a reply or a vendor",
    );
  });

  it("names the target for a running clock and the finish for a completed one", () => {
    expect(
      describeClock("response", {
        state: "ON_TRACK",
        dueAt: "2026-09-30T10:00:00Z",
        completedAt: null,
      }),
    ).toMatch(/^Respond by /);
    expect(
      describeClock("resolution", {
        state: "MET",
        dueAt: "2026-09-30T10:00:00Z",
        completedAt: "2026-09-30T09:00:00Z",
      }),
    ).toMatch(/^Resolved /);
  });
});
