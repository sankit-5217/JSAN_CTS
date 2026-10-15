import { formatUtc } from "./time";

describe("formatUtc", () => {
  it("formats ISO-8601 in UTC with the zone written", () => {
    expect(formatUtc("2026-10-15T11:46:00.000Z")).toBe("15 Oct 2026, 11:46 UTC");
    expect(formatUtc("2026-10-15T23:30:00+05:30")).toBe("15 Oct 2026, 18:00 UTC");
  });

  it('reads "YYYY-MM-DD HH:MM" as UTC', () => {
    expect(formatUtc("2026-09-28 10:00")).toBe("28 Sep 2026, 10:00 UTC");
  });

  it("leaves anything else alone", () => {
    expect(formatUtc("soon")).toBe("soon");
    expect(formatUtc("t")).toBe("t");
  });
});
