import { useSyncExternalStore } from "react";
import { getStoredToken } from "../api/client";
import { decodeJwtPayload } from "../api/jwt";
import type { AudibleUrgency } from "./types";

/**
 * Each user's own sound settings. They live in this browser only (per
 * signed-in user), since they're about this desk's speakers, not about the
 * user's account. Which events are loud is decided server-side by the
 * notification sound rules; these settings only turn tiers down or off.
 */
export interface SoundPrefs {
  muted: boolean;
  /** 0-1 */
  volume: number;
  tiers: Record<AudibleUrgency, boolean>;
  /** Also show a desktop notification when the tab is in the background. */
  desktop: boolean;
}

export const DEFAULT_SOUND_PREFS: SoundPrefs = {
  muted: false,
  volume: 0.7,
  tiers: { CRITICAL: true, HIGH: true, NORMAL: true },
  desktop: false,
};

const CHANGE_EVENT = "opsdesk-sound-prefs";

function storageKey(): string {
  const token = getStoredToken();
  const sub = token ? decodeJwtPayload(token)?.sub : null;
  return `opsdesk_sound_prefs:${sub ?? "anonymous"}`;
}

let cached: { key: string; raw: string | null; prefs: SoundPrefs } | null = null;

export function readSoundPrefs(): SoundPrefs {
  const key = storageKey();
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(key);
  } catch {
    // Storage blocked: defaults.
  }
  // useSyncExternalStore needs the same object back while nothing changed.
  if (cached && cached.key === key && cached.raw === raw) {
    return cached.prefs;
  }
  let prefs = DEFAULT_SOUND_PREFS;
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<SoundPrefs>;
      prefs = {
        ...DEFAULT_SOUND_PREFS,
        ...parsed,
        tiers: { ...DEFAULT_SOUND_PREFS.tiers, ...parsed.tiers },
      };
    } catch {
      // Corrupt value: defaults.
    }
  }
  cached = { key, raw, prefs };
  return prefs;
}

export function writeSoundPrefs(patch: Partial<SoundPrefs>): void {
  const next = { ...readSoundPrefs(), ...patch };
  try {
    localStorage.setItem(storageKey(), JSON.stringify(next));
  } catch {
    // Storage blocked: the change lasts until reload at most.
    cached = { key: storageKey(), raw: null, prefs: next };
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function subscribe(listener: () => void): () => void {
  // "storage" fires when another tab changes the settings.
  window.addEventListener(CHANGE_EVENT, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener);
    window.removeEventListener("storage", listener);
  };
}

export function useSoundPrefs(): SoundPrefs {
  return useSyncExternalStore(subscribe, readSoundPrefs);
}
