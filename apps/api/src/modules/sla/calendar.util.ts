import { SupportCalendar } from "@prisma/client";
import { DateTime } from "luxon";

/** The subset of `SupportCalendar` the calendar math actually needs. */
export type BusinessCalendar = Pick<
  SupportCalendar,
  "businessStart" | "businessEnd" | "workdays" | "holidays" | "is247"
>;

/** Bounds the day-by-day walk so a malformed calendar can't loop forever. */
const MAX_WALK_DAYS = 366;

/**
 * Adds `minutes` to `from`, respecting a site's business calendar (spec
 * §10.8: "Support calendar: per site/service ... never hard-code one
 * global clock").
 *
 * `calendar` absent, or `calendar.is247` true, means plain 24x7 wall-clock
 * addition — the "Typically 24x7" clock column for P1. Otherwise this
 * walks forward through the calendar's business window
 * (`businessStart`-`businessEnd`, `workdays`, skipping `holidays`) in
 * `siteTimezone`, so a target spanning a weekend or an overnight gap
 * counts only in-window minutes.
 *
 * Pure function — no DB access — so it's directly unit-testable.
 */
export function addBusinessMinutes(
  calendar: BusinessCalendar | null,
  siteTimezone: string,
  from: Date,
  minutes: number,
): Date {
  if (minutes < 0) {
    throw new Error("minutes must not be negative");
  }
  if (!calendar || calendar.is247) {
    return DateTime.fromJSDate(from).plus({ minutes }).toJSDate();
  }

  const { startHour, startMinute, endHour, endMinute } = parseWindow(calendar);
  const workdaySet = new Set(calendar.workdays);
  const holidaySet = new Set(
    calendar.holidays.map((h) => DateTime.fromJSDate(h).setZone(siteTimezone).toISODate()),
  );

  let remaining = minutes;
  let cursor = snapToWindow(
    DateTime.fromJSDate(from).setZone(siteTimezone),
    workdaySet,
    holidaySet,
    startHour,
    startMinute,
    endHour,
    endMinute,
  );

  while (remaining > 0) {
    const windowEnd = cursor.set({ hour: endHour, minute: endMinute, second: 0, millisecond: 0 });
    const minutesLeftToday = Math.floor(windowEnd.diff(cursor, "minutes").minutes);

    if (remaining <= minutesLeftToday) {
      cursor = cursor.plus({ minutes: remaining });
      remaining = 0;
    } else {
      remaining -= minutesLeftToday;
      cursor = snapToWindow(
        cursor.plus({ days: 1 }).set({ hour: 0, minute: 0, second: 0, millisecond: 0 }),
        workdaySet,
        holidaySet,
        startHour,
        startMinute,
        endHour,
        endMinute,
      );
    }
  }

  return cursor.toJSDate();
}

function parseWindow(calendar: BusinessCalendar) {
  const [startHour, startMinute] = calendar.businessStart.split(":").map(Number);
  const [endHour, endMinute] = calendar.businessEnd.split(":").map(Number);
  const windowMinutes = endHour * 60 + endMinute - (startHour * 60 + startMinute);
  if (calendar.workdays.length === 0 || windowMinutes <= 0) {
    throw new Error("Support calendar has no usable business window");
  }
  return { startHour, startMinute, endHour, endMinute };
}

/**
 * Moves `dt` forward to the next instant that's inside a business window:
 * a configured workday, not a holiday, and at-or-after `businessStart`
 * (advancing to the next day if `dt` is already past `businessEnd`).
 * `dt` already inside today's window is returned unchanged.
 *
 * Luxon's `weekday` is 1 (Mon) .. 7 (Sun); `% 7` maps it onto the schema's
 * 0=Sun .. 6=Sat convention (Sunday: 7 % 7 = 0; Monday: 1 % 7 = 1; ...).
 */
function snapToWindow(
  dt: DateTime,
  workdaySet: Set<number>,
  holidaySet: Set<string | null>,
  startHour: number,
  startMinute: number,
  endHour: number,
  endMinute: number,
): DateTime {
  let cursor = dt;
  for (let i = 0; i < MAX_WALK_DAYS; i += 1) {
    const isWorkday = workdaySet.has(cursor.weekday % 7);
    const isHoliday = holidaySet.has(cursor.toISODate());
    if (isWorkday && !isHoliday) {
      const windowStart = cursor.set({
        hour: startHour,
        minute: startMinute,
        second: 0,
        millisecond: 0,
      });
      const windowEnd = cursor.set({ hour: endHour, minute: endMinute, second: 0, millisecond: 0 });
      if (cursor < windowStart) {
        return windowStart;
      }
      if (cursor < windowEnd) {
        return cursor;
      }
      // Past today's window — fall through to try tomorrow.
    }
    cursor = cursor.plus({ days: 1 }).set({ hour: 0, minute: 0, second: 0, millisecond: 0 });
  }
  throw new Error("Could not find a business window within a year — check calendar configuration");
}
