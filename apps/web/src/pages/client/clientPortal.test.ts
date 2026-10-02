import { describe, expect, it } from "vitest";
import { describeActivity, describeClock, type PortalTicket } from "./clientPortal";

const since = () => "12m ago";
const activity = (overrides: Partial<PortalTicket["activity"]> = {}): PortalTicket["activity"] => ({
  engineer: "Rahul",
  duty: "ON_SHIFT",
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

  it("says whether the assigned engineer is on duty", () => {
    expect(describeActivity(activity(), since)).toBe("Rahul is on shift now");
    expect(describeActivity(activity({ duty: "ON_CALL" }), since)).toBe("Rahul is on call now");
    expect(describeActivity(activity({ duty: "OFF_DUTY" }), since)).toBe(
      "Rahul is off shift right now; the on-duty team is covering",
    );
  });

  it("says nothing for an unassigned ticket", () => {
    expect(describeActivity(activity({ engineer: null, duty: null }), since)).toBeNull();
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
