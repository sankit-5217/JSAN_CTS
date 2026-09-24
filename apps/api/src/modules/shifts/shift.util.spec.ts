import { isShiftActiveAt, ShiftWindow } from "./shift.util";

describe("isShiftActiveAt", () => {
  describe("same-day window", () => {
    const morning: ShiftWindow = { daysOfWeek: [4], startTime: "06:00", endTime: "14:00" }; // Thu

    it("is active inside the window on a listed day", () => {
      // 2026-09-03 is a Thursday (same fixture date calendar.util.spec.ts uses).
      expect(isShiftActiveAt(morning, "UTC", new Date("2026-09-03T10:00:00Z"))).toBe(true);
    });

    it("is not active before the window starts", () => {
      expect(isShiftActiveAt(morning, "UTC", new Date("2026-09-03T05:59:00Z"))).toBe(false);
    });

    it("end time is exclusive — not active exactly at, or after, the end", () => {
      expect(isShiftActiveAt(morning, "UTC", new Date("2026-09-03T14:00:00Z"))).toBe(false);
      expect(isShiftActiveAt(morning, "UTC", new Date("2026-09-03T15:00:00Z"))).toBe(false);
    });

    it("is not active inside the same clock window on a day that isn't listed", () => {
      // 2026-09-04 is a Friday — not in daysOfWeek: [4] (Thu only).
      expect(isShiftActiveAt(morning, "UTC", new Date("2026-09-04T10:00:00Z"))).toBe(false);
    });
  });

  describe("overnight wrap (startTime > endTime)", () => {
    const night: ShiftWindow = { daysOfWeek: [4], startTime: "22:00", endTime: "06:00" }; // starts Thu

    it("is active late on the day it starts", () => {
      expect(isShiftActiveAt(night, "UTC", new Date("2026-09-03T23:00:00Z"))).toBe(true);
    });

    it("is active in the early hours of the day after it starts", () => {
      // 2026-09-04 02:00 — the shift that started Thursday night is still
      // running into Friday morning, even though Friday itself isn't listed.
      expect(isShiftActiveAt(night, "UTC", new Date("2026-09-04T02:00:00Z"))).toBe(true);
    });

    it("end time is still exclusive across the wrap", () => {
      expect(isShiftActiveAt(night, "UTC", new Date("2026-09-04T06:00:00Z"))).toBe(false);
    });

    it("does not carry over from a day that wasn't actually listed", () => {
      // daysOfWeek lists Friday (5), not Thursday — at Friday 02:00 the
      // relevant "started yesterday" day is Thursday, which isn't listed,
      // and Friday's own 22:00 start hasn't happened yet.
      const fridayOnly: ShiftWindow = { daysOfWeek: [5], startTime: "22:00", endTime: "06:00" };
      expect(isShiftActiveAt(fridayOnly, "UTC", new Date("2026-09-04T02:00:00Z"))).toBe(false);
    });

    it("is not active in the afternoon between the two overnight legs", () => {
      expect(isShiftActiveAt(night, "UTC", new Date("2026-09-03T15:00:00Z"))).toBe(false);
    });
  });

  it("converts to the site's own timezone before comparing", () => {
    const shift: ShiftWindow = { daysOfWeek: [4], startTime: "06:00", endTime: "14:00" };
    // 10:00 UTC = 06:00 America/New_York (EDT, UTC-4) in September — right
    // at the window's start in that site's local time.
    expect(isShiftActiveAt(shift, "America/New_York", new Date("2026-09-03T10:00:00Z"))).toBe(true);
    // The same instant is 6pm+ in a UTC+8 zone — well outside the window.
    expect(isShiftActiveAt(shift, "Asia/Shanghai", new Date("2026-09-03T10:00:00Z"))).toBe(false);
  });
});
