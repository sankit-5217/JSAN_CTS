import type { AudibleUrgency } from "./types";

/**
 * The ops console's notification tones, synthesized with the Web Audio API
 * so there are no audio files to ship or license.
 *
 * Browsers keep audio locked until the user interacts with the page, so the
 * AudioContext is only created (or resumed) from a click or key press;
 * installAudioUnlock() hooks that up once at startup. Until then play()
 * returns false and useAudioBlocked() reports true so the UI can say so.
 */

interface Note {
  /** Seconds after the start of the tone. */
  at: number;
  freq: number;
  duration: number;
  type: OscillatorType;
  /** Peak gain before the master volume, 0-1. */
  peak: number;
}

// CRITICAL is an insistent alternating two-tone alarm, HIGH a rising
// two-note chime, NORMAL a single soft ping.
const TONES: Record<AudibleUrgency, Note[]> = {
  CRITICAL: [0, 1, 2, 3, 4, 5].map((i) => ({
    at: i * 0.2,
    freq: i % 2 === 0 ? 988 : 740,
    duration: 0.16,
    type: "square" as const,
    peak: 0.35,
  })),
  HIGH: [
    { at: 0, freq: 659, duration: 0.35, type: "sine", peak: 0.8 },
    { at: 0.18, freq: 988, duration: 0.5, type: "sine", peak: 0.8 },
  ],
  NORMAL: [{ at: 0, freq: 880, duration: 0.4, type: "sine", peak: 0.6 }],
};

let context: AudioContext | null = null;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((l) => l());
}

function unlock() {
  try {
    if (!context) {
      context = new AudioContext();
      context.addEventListener("statechange", notify);
    }
    if (context.state === "suspended") {
      void context.resume().then(notify);
    }
    notify();
  } catch {
    // No Web Audio in this browser; isAudioBlocked() stays true.
  }
}

let unlockInstalled = false;

/** Unlocks audio on the first user gesture. Safe to call more than once. */
export function installAudioUnlock(): void {
  if (unlockInstalled || typeof window === "undefined") {
    return;
  }
  unlockInstalled = true;
  window.addEventListener("pointerdown", unlock, { capture: true });
  window.addEventListener("keydown", unlock, { capture: true });
}

export function isAudioBlocked(): boolean {
  return !context || context.state !== "running";
}

export function subscribeAudioState(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Plays one tone at `volume` (0-1). Returns false if audio is still locked. */
export function playTone(urgency: AudibleUrgency, volume: number): boolean {
  if (!context || context.state !== "running") {
    return false;
  }
  const ctx = context;
  const master = ctx.createGain();
  master.gain.value = Math.min(Math.max(volume, 0), 1);
  master.connect(ctx.destination);
  const start = ctx.currentTime + 0.02;
  let end = start;
  for (const note of TONES[urgency]) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = note.type;
    osc.frequency.value = note.freq;
    const t0 = start + note.at;
    const t1 = t0 + note.duration;
    // Short attack and exponential release so notes don't click.
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(note.peak, t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t1);
    osc.connect(gain).connect(master);
    osc.start(t0);
    osc.stop(t1 + 0.02);
    end = Math.max(end, t1);
  }
  window.setTimeout(() => master.disconnect(), (end - ctx.currentTime + 0.1) * 1000);
  return true;
}
