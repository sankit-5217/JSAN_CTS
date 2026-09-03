import { deriveChangeStatus, isEditable, isPirOverdue } from "./changes.status";
import type { ChangeStatusInput } from "./changes.status";

const NOW = new Date("2026-09-05T22:30:00.000Z");

function change(overrides: Partial<ChangeStatusInput> = {}): ChangeStatusInput {
  return {
    approverId: "user-1",
    windowStart: new Date("2026-09-05T22:00:00.000Z"),
    windowEnd: new Date("2026-09-05T23:00:00.000Z"),
    outcome: null,
    changeType: "NORMAL",
    ...overrides,
  };
}

describe("deriveChangeStatus", () => {
  it("is PENDING_APPROVAL with no approver", () => {
    expect(deriveChangeStatus(change({ approverId: null }), NOW)).toBe("PENDING_APPROVAL");
  });

  it("is SCHEDULED when approved and the window is in the future", () => {
    expect(
      deriveChangeStatus(change({ windowStart: new Date("2026-09-06T00:00:00.000Z") }), NOW),
    ).toBe("SCHEDULED");
  });

  it("is IN_PROGRESS when approved and now is inside the window", () => {
    expect(deriveChangeStatus(change(), NOW)).toBe("IN_PROGRESS");
  });

  it("is PENDING_REVIEW when approved, past the window, with no outcome", () => {
    expect(
      deriveChangeStatus(change({ windowEnd: new Date("2026-09-05T22:15:00.000Z") }), NOW),
    ).toBe("PENDING_REVIEW");
  });

  it("is COMPLETED once an outcome is recorded", () => {
    expect(deriveChangeStatus(change({ outcome: "done, redundancy verified" }), NOW)).toBe(
      "COMPLETED",
    );
  });
});

describe("isPirOverdue", () => {
  const pastWindow = { windowEnd: new Date("2026-09-05T22:15:00.000Z") };

  it("is true for an emergency change past its window with no outcome", () => {
    expect(isPirOverdue(change({ changeType: "EMERGENCY", ...pastWindow }), NOW)).toBe(true);
  });

  it("is false for a non-emergency change in the same state", () => {
    expect(isPirOverdue(change({ changeType: "NORMAL", ...pastWindow }), NOW)).toBe(false);
  });

  it("is false once the emergency change has an outcome", () => {
    expect(
      isPirOverdue(change({ changeType: "EMERGENCY", ...pastWindow, outcome: "reviewed" }), NOW),
    ).toBe(false);
  });
});

describe("isEditable", () => {
  it("allows edits before work starts only", () => {
    expect(isEditable("PENDING_APPROVAL")).toBe(true);
    expect(isEditable("SCHEDULED")).toBe(true);
    expect(isEditable("IN_PROGRESS")).toBe(false);
    expect(isEditable("PENDING_REVIEW")).toBe(false);
    expect(isEditable("COMPLETED")).toBe(false);
  });
});
