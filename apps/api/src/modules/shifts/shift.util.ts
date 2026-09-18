import { DateTime } from "luxon";

/** The subset of `EngineerShift` the "is this active right now" math needs. */
export interface ShiftWindow {
  daysOfWeek: number[];
  startTime: string;
  endTime: string;
}

/**
 * Is `shift` covering `now` (site-local time)? Mirrors calendar.util.ts's
 * "HH:MM" + 0=Sun..6=Sat conventions (SupportCalendar.businessStart/
 * businessEnd, .workdays), so a shift reads the same way a support calendar
 * does elsewhere in this codebase.
 *
 * `startTime > endTime` is an overnight wrap (e.g. "22:00"-"06:00");
 * `daysOfWeek` names the day the shift *starts* on, same as a real duty
 * roster — a Friday-night shift is listed under Friday even though it runs
 * past midnight into Saturday.
 *
 * Pure function — no DB access — directly unit-testable, same posture as
 * addBusinessMinutes.
 */
export function isShiftActiveAt(shift: ShiftWindow, siteTimezone: string, now: Date): boolean {
  const nowLocal = DateTime.fromJSDate(now).setZone(siteTimezone);
  const { hour: startHour, minute: startMinute } = parseClock(shift.startTime);
  const { hour: endHour, minute: endMinute } = parseClock(shift.endTime);
  const todayStart = nowLocal.set({ hour: startHour, minute: startMinute, second: 0, millisecond: 0 });
  const todayEnd = nowLocal.set({ hour: endHour, minute: endMinute, second: 0, millisecond: 0 });
  const today = nowLocal.weekday % 7; // Luxon: 1=Mon..7=Sun -> 0=Sun..6=Sat
  const yesterday = (today + 6) % 7;

  if (todayStart <= todayEnd) {
    // Same-day window: active only on a listed start day, between start/end.
    return shift.daysOfWeek.includes(today) && nowLocal >= todayStart && nowLocal < todayEnd;
  }

  // Overnight wrap: either the shift started today (listed day, now past
  // start) or it started yesterday and hasn't reached today's end yet
  // (yesterday listed, now before end).
  const startedToday = shift.daysOfWeek.includes(today) && nowLocal >= todayStart;
  const continuesFromYesterday = shift.daysOfWeek.includes(yesterday) && nowLocal < todayEnd;
  return startedToday || continuesFromYesterday;
}

function parseClock(value: string): { hour: number; minute: number } {
  const [hour, minute] = value.split(":").map(Number);
  return { hour, minute };
}
