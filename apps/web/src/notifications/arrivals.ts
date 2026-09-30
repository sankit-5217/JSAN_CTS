import type { AudibleUrgency, InAppNotification, NotificationUrgency } from "./types";
import type { SoundPrefs } from "./soundPrefs";

const RANK: Record<NotificationUrgency, number> = { CRITICAL: 3, HIGH: 2, NORMAL: 1, SILENT: 0 };

/**
 * Tracks which notifications this tab has already seen, so only genuinely
 * new ones make a sound. The first list after sign-in or reload is taken as
 * the baseline and stays quiet: it's the backlog, not something arriving.
 */
export class ArrivalTracker {
  private seen: Set<string> | null = null;

  /** New, unread notifications in `items` since the last call. */
  next(items: InAppNotification[]): InAppNotification[] {
    if (!this.seen) {
      this.seen = new Set(items.map((i) => i.id));
      return [];
    }
    const arrivals = items.filter((i) => !this.seen!.has(i.id) && !i.readAt);
    items.forEach((i) => this.seen!.add(i.id));
    return arrivals;
  }
}

/** The loudest tier among `items` that the user's settings let through, or
 *  null when nothing should sound. One poll makes at most one sound. */
export function loudestAudible(
  items: InAppNotification[],
  prefs: SoundPrefs,
): AudibleUrgency | null {
  if (prefs.muted) {
    return null;
  }
  let best: AudibleUrgency | null = null;
  for (const item of items) {
    const u = item.urgency;
    if (u !== "SILENT" && prefs.tiers[u] && (!best || RANK[u] > RANK[best])) {
      best = u;
    }
  }
  return best;
}

const ANNOUNCED_KEY = "opsdesk_sound_announced";
const ANNOUNCED_CAP = 200;

/**
 * With the console open in several tabs, every tab sees the same arrival.
 * The first tab to claim an id plays it; the rest stay quiet. Returns the
 * items this tab won. If storage is unavailable, every tab plays.
 */
export function claimArrivals(
  items: InAppNotification[],
  storage: Pick<Storage, "getItem" | "setItem"> | null = safeLocalStorage(),
): InAppNotification[] {
  if (!storage || items.length === 0) {
    return items;
  }
  try {
    const announced: string[] = JSON.parse(storage.getItem(ANNOUNCED_KEY) ?? "[]");
    const taken = new Set(announced);
    const won = items.filter((i) => !taken.has(i.id));
    if (won.length > 0) {
      storage.setItem(
        ANNOUNCED_KEY,
        JSON.stringify([...announced, ...won.map((i) => i.id)].slice(-ANNOUNCED_CAP)),
      );
    }
    return won;
  } catch {
    return items;
  }
}

function safeLocalStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
