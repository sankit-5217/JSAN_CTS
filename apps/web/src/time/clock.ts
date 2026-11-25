/**
 * Times on screen. Clients and the JSAN team sit in different countries, so
 * every time is shown in the **viewer's own** clock (their device's time
 * zone) with the zone written next to it — "15 Oct 2026, 5:20 pm IST" for
 * someone in India, "15 Oct 2026, 12:50 pm BST" for the same moment in
 * London. The API stores and sends UTC; nothing is converted server-side.
 */

type When = string | number | Date;

const toDate = (when: When): Date => (when instanceof Date ? when : new Date(when));

/** The viewer's IANA time zone, e.g. "Asia/Kolkata". */
export function viewerTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

/** "15 Oct 2026, 5:20 pm IST" — date, time and zone. */
export function formatDateTime(when: When, timeZone?: string): string {
  const d = toDate(when);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
    ...(timeZone ? { timeZone } : {}),
  }).format(d);
}

/** "5:20 pm IST" — time and zone, for today's events (offers, "updated at"). */
export function formatTime(when: When, timeZone?: string): string {
  const d = toDate(when);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
    ...(timeZone ? { timeZone } : {}),
  }).format(d);
}
