import { addBusinessMinutes, BusinessCalendar } from "./calendar.util";

const businessHours: BusinessCalendar = {
  businessStart: "09:00",
  businessEnd: "18:00",
  workdays: [1, 2, 3, 4, 5], // Mon-Fri
  holidays: [],
  is247: false,
};

describe("addBusinessMinutes", () => {
  it("adds plain wall-clock minutes for a 24x7 calendar", () => {
    const from = new Date("2026-09-03T10:00:00Z"); // Thursday
    const result = addBusinessMinutes({ ...businessHours, is247: true }, "UTC", from, 4 * 60);
    expect(result.toISOString()).toBe("2026-09-03T14:00:00.000Z");
  });

  it("adds plain wall-clock minutes when no calendar is configured", () => {
    const from = new Date("2026-09-03T10:00:00Z");
    const result = addBusinessMinutes(null, "UTC", from, 15);
    expect(result.toISOString()).toBe("2026-09-03T10:15:00.000Z");
  });

  it("stays within the same business day when the target fits", () => {
    // Thursday 10:00 UTC (calendar in UTC) + 4h -> 14:00 same day.
    const from = new Date("2026-09-03T10:00:00Z");
    const result = addBusinessMinutes(businessHours, "UTC", from, 4 * 60);
    expect(result.toISOString()).toBe("2026-09-03T14:00:00.000Z");
  });

  it("rolls over to the next business day when the target exceeds today's window", () => {
    // Thursday 17:00 UTC, 1h left today (until 18:00); remaining 2h rolls
    // to Friday 09:00 + 2h = Friday 11:00.
    const from = new Date("2026-09-03T17:00:00Z");
    const result = addBusinessMinutes(businessHours, "UTC", from, 3 * 60);
    expect(result.toISOString()).toBe("2026-09-04T11:00:00.000Z");
  });

  it("skips a weekend", () => {
    // Friday 17:00 UTC, 1h left today + need 2h more -> rolls to Monday
    // 09:00 + 1h = Monday 10:00 (skipping Sat/Sun entirely).
    const from = new Date("2026-09-04T17:00:00Z"); // Friday
    const result = addBusinessMinutes(businessHours, "UTC", from, 2 * 60);
    expect(result.toISOString()).toBe("2026-09-07T10:00:00.000Z"); // Monday
  });

  it("skips a configured holiday", () => {
    // Thursday 17:00 UTC, 1h left today, Friday is a holiday -> rolls
    // through the weekend to Monday 09:00 + 1h = Monday 10:00.
    const from = new Date("2026-09-03T17:00:00Z"); // Thursday
    const calendar: BusinessCalendar = {
      ...businessHours,
      holidays: [new Date("2026-09-04T00:00:00Z")], // Friday
    };
    const result = addBusinessMinutes(calendar, "UTC", from, 2 * 60);
    expect(result.toISOString()).toBe("2026-09-07T10:00:00.000Z"); // Monday
  });

  it("snaps a start time before business hours forward to the window open", () => {
    // Thursday 06:00 UTC (before 09:00 open) + 30min -> 09:30 same day.
    const from = new Date("2026-09-03T06:00:00Z");
    const result = addBusinessMinutes(businessHours, "UTC", from, 30);
    expect(result.toISOString()).toBe("2026-09-03T09:30:00.000Z");
  });

  it("snaps a start time after business hours to the next workday", () => {
    // Thursday 20:00 UTC (after 18:00 close) + 30min -> Friday 09:30.
    const from = new Date("2026-09-03T20:00:00Z");
    const result = addBusinessMinutes(businessHours, "UTC", from, 30);
    expect(result.toISOString()).toBe("2026-09-04T09:30:00.000Z");
  });

  it("respects a non-UTC site timezone", () => {
    // Calendar 09:00-18:00 Asia/Kolkata (UTC+5:30). 2026-09-03T10:00:00Z ==
    // 15:30 IST, 2.5h left today -> +3h rolls to next workday 09:00 IST +
    // 30min = 09:30 IST = 04:00Z the next day.
    const from = new Date("2026-09-03T10:00:00Z"); // Thursday
    const result = addBusinessMinutes(businessHours, "Asia/Kolkata", from, 3 * 60);
    expect(result.toISOString()).toBe("2026-09-04T04:00:00.000Z");
  });

  it("rejects a negative minutes value", () => {
    expect(() => addBusinessMinutes(businessHours, "UTC", new Date(), -1)).toThrow();
  });

  it("rejects a calendar with no configured workdays", () => {
    const calendar: BusinessCalendar = { ...businessHours, workdays: [] };
    expect(() => addBusinessMinutes(calendar, "UTC", new Date(), 30)).toThrow();
  });
});
