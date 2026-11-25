const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * A time in an email, readable anywhere: "15 Oct 2026, 11:46 UTC". An email
 * can't know its reader's time zone (clients are worldwide), so it always
 * says UTC explicitly; the portal shows the same moment in the reader's own
 * clock. Accepts ISO-8601 or "YYYY-MM-DD HH:MM" (taken as UTC); anything
 * else comes back unchanged.
 */
export function formatUtc(value: string): string {
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(value)
    ? `${value.replace(" ", "T")}:00Z`
    : value;
  const d = new Date(iso);
  if (!/^\d{4}-\d{2}-\d{2}/.test(value) || Number.isNaN(d.getTime())) return value;
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${hh}:${mm} UTC`;
}
