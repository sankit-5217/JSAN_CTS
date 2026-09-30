import { useCallback, useEffect, useRef } from "react";
import { ArrivalTracker, claimArrivals, loudestAudible } from "./arrivals";
import { useSoundPrefs } from "./soundPrefs";
import { installAudioUnlock, playTone } from "./tones";
import type { InAppNotification } from "./types";

/** How often an unacknowledged CRITICAL notification sounds again. */
const ALARM_REPEAT_MS = 10_000;
/** Written when the user acknowledges, so the alarm stops in every tab. */
const ACK_KEY = "opsdesk_sound_ack";
/** At most this many desktop notifications per poll. */
const DESKTOP_LIMIT = 3;

interface Options {
  /** The latest poll of GET /notifications; undefined until the first one lands. */
  items: InAppNotification[] | undefined;
  /** Off in the client portal: sounds are an ops console feature. */
  enabled: boolean;
  /** Opening the bell counts as acknowledging, which stops a repeating alarm. */
  panelOpen: boolean;
}

/**
 * Plays the tone for new notifications as the bell's polls bring them in.
 * One poll makes one sound, at its loudest tier. A CRITICAL arrival then
 * repeats every {@link ALARM_REPEAT_MS} until the user opens the bell (in
 * any tab), reads it, or mutes sounds.
 */
export function useNotificationSounds({ items, enabled, panelOpen }: Options): void {
  const prefs = useSoundPrefs();
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const tracker = useRef(new ArrivalTracker());
  const alarmIds = useRef(new Set<string>());
  const alarmTimer = useRef<number | null>(null);

  const stopAlarm = useCallback(() => {
    alarmIds.current.clear();
    if (alarmTimer.current !== null) {
      window.clearInterval(alarmTimer.current);
      alarmTimer.current = null;
    }
  }, []);

  const startAlarm = useCallback(() => {
    if (alarmTimer.current !== null) {
      return;
    }
    alarmTimer.current = window.setInterval(() => {
      const p = prefsRef.current;
      if (p.muted || !p.tiers.CRITICAL || alarmIds.current.size === 0) {
        stopAlarm();
        return;
      }
      playTone("CRITICAL", p.volume);
    }, ALARM_REPEAT_MS);
  }, [stopAlarm]);

  useEffect(() => {
    if (enabled) {
      installAudioUnlock();
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !items) {
      return;
    }
    // Read somewhere else (another tab, the incident page): no longer alarming.
    for (const item of items) {
      if (item.readAt) {
        alarmIds.current.delete(item.id);
      }
    }
    const arrivals = tracker.current.next(items).filter((i) => i.urgency !== "SILENT");
    const won = claimArrivals(arrivals);
    if (won.length > 0) {
      const p = prefsRef.current;
      const tier = loudestAudible(won, p);
      if (tier) {
        playTone(tier, p.volume);
      }
      if (tier === "CRITICAL") {
        won.filter((i) => i.urgency === "CRITICAL").forEach((i) => alarmIds.current.add(i.id));
        startAlarm();
      }
      showDesktopNotifications(won, p.desktop);
    }
    if (alarmIds.current.size === 0) {
      stopAlarm();
    }
  }, [items, enabled, startAlarm, stopAlarm]);

  useEffect(() => {
    if (!enabled || !panelOpen) {
      return;
    }
    stopAlarm();
    // Always broadcast: the tab that's ringing may not be this one.
    try {
      localStorage.setItem(ACK_KEY, String(Date.now()));
    } catch {
      // Other tabs keep ringing until opened there too.
    }
  }, [enabled, panelOpen, stopAlarm]);

  useEffect(() => {
    if (prefs.muted || !prefs.tiers.CRITICAL) {
      stopAlarm();
    }
  }, [prefs.muted, prefs.tiers.CRITICAL, stopAlarm]);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === ACK_KEY) {
        stopAlarm();
      }
    };
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("storage", onStorage);
      stopAlarm();
    };
  }, [stopAlarm]);
}

function showDesktopNotifications(items: InAppNotification[], wanted: boolean): void {
  if (
    !wanted ||
    document.visibilityState === "visible" ||
    typeof Notification === "undefined" ||
    Notification.permission !== "granted"
  ) {
    return;
  }
  for (const item of items.slice(0, DESKTOP_LIMIT)) {
    try {
      const n = new Notification(item.title, {
        body: item.body ?? undefined,
        tag: item.id,
        requireInteraction: item.urgency === "CRITICAL",
      });
      n.onclick = () => {
        window.focus();
        n.close();
      };
    } catch {
      // Some browsers only allow notifications from a service worker.
    }
  }
}
