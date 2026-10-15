import { describe, expect, it } from "vitest";
import { formatDateTime, formatTime, viewerTimeZone } from "./clock";

const MOMENT = "2026-10-15T11:50:00.000Z";

describe("clock: every viewer sees the same moment in their own zone, zone written", () => {
  it("shows the moment in India as IST time with the zone", () => {
    const text = formatDateTime(MOMENT, "Asia/Kolkata");
    expect(text).toMatch(/15/);
    expect(text).toMatch(/2026/);
    expect(text).toMatch(/5:20/); // 11:50 UTC + 5:30
    expect(text).toMatch(/GMT\+5:30|IST/);
  });

  it("shows the same moment in London and New York in their own clocks", () => {
    expect(formatDateTime(MOMENT, "Europe/London")).toMatch(/12:50/);
    expect(formatDateTime(MOMENT, "Europe/London")).toMatch(/BST|GMT\+1/);
    expect(formatDateTime(MOMENT, "America/New_York")).toMatch(/7:50/);
    expect(formatDateTime(MOMENT, "America/New_York")).toMatch(/EDT|GMT-4/);
  });

  it("crosses midnight correctly (the date follows the viewer's zone)", () => {
    const late = "2026-10-15T20:00:00.000Z";
    expect(formatDateTime(late, "Asia/Tokyo")).toMatch(/16/); // 05:00 next day in Tokyo
    expect(formatDateTime(late, "America/Los_Angeles")).toMatch(/15/);
  });

  it("time-only keeps the zone", () => {
    expect(formatTime(MOMENT, "UTC")).toMatch(/11:50/);
    expect(formatTime(MOMENT, "UTC")).toMatch(/UTC/);
  });

  it("accepts Date objects and epoch milliseconds", () => {
    const d = new Date(MOMENT);
    expect(formatDateTime(d, "UTC")).toBe(formatDateTime(MOMENT, "UTC"));
    expect(formatDateTime(d.getTime(), "UTC")).toBe(formatDateTime(MOMENT, "UTC"));
  });

  it("never prints 'Invalid Date'", () => {
    expect(formatDateTime("not a date")).toBe("—");
    expect(formatTime("")).toBe("—");
  });

  it("knows the viewer's zone", () => {
    expect(viewerTimeZone()).toMatch(/\w/);
  });
});
