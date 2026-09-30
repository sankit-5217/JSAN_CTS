import { describe, expect, it } from "vitest";
import { ArrivalTracker, claimArrivals, loudestAudible } from "./arrivals";
import { DEFAULT_SOUND_PREFS, type SoundPrefs } from "./soundPrefs";
import type { InAppNotification, NotificationUrgency } from "./types";

function n(id: string, urgency: NotificationUrgency = "NORMAL", readAt: string | null = null) {
  return {
    id,
    kind: "INCIDENT_ASSIGNED",
    title: id,
    body: null,
    entityType: "INCIDENT",
    entityId: "inc-1",
    urgency,
    readAt,
    createdAt: "2026-09-30T00:00:00Z",
  } satisfies InAppNotification;
}

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

describe("ArrivalTracker", () => {
  it("treats the first list as the backlog and stays quiet", () => {
    const tracker = new ArrivalTracker();
    expect(tracker.next([n("a"), n("b")])).toEqual([]);
  });

  it("returns only unseen, unread notifications after that", () => {
    const tracker = new ArrivalTracker();
    tracker.next([n("a")]);
    expect(tracker.next([n("c", "HIGH", "2026-09-30T00:01:00Z"), n("b"), n("a")])).toEqual([
      n("b"),
    ]);
    expect(tracker.next([n("b"), n("a")])).toEqual([]);
  });

  it("an empty first list still sets the baseline", () => {
    const tracker = new ArrivalTracker();
    tracker.next([]);
    expect(tracker.next([n("a")])).toEqual([n("a")]);
  });
});

describe("loudestAudible", () => {
  const prefs = (patch: Partial<SoundPrefs> = {}): SoundPrefs => ({
    ...DEFAULT_SOUND_PREFS,
    ...patch,
  });

  it("picks the loudest tier in the batch", () => {
    expect(loudestAudible([n("a"), n("b", "CRITICAL"), n("c", "HIGH")], prefs())).toBe("CRITICAL");
  });

  it("is null when muted or everything is silent", () => {
    expect(loudestAudible([n("a", "CRITICAL")], prefs({ muted: true }))).toBeNull();
    expect(loudestAudible([n("a", "SILENT")], prefs())).toBeNull();
    expect(loudestAudible([], prefs())).toBeNull();
  });

  it("skips tiers the user turned off", () => {
    const p = prefs({ tiers: { CRITICAL: false, HIGH: true, NORMAL: true } });
    expect(loudestAudible([n("a", "CRITICAL"), n("b")], p)).toBe("NORMAL");
  });
});

describe("claimArrivals", () => {
  it("lets only the first tab claim each notification", () => {
    const storage = memoryStorage();
    expect(claimArrivals([n("a"), n("b")], storage)).toEqual([n("a"), n("b")]);
    expect(claimArrivals([n("a"), n("b"), n("c")], storage)).toEqual([n("c")]);
  });

  it("plays everything when storage is unavailable or broken", () => {
    expect(claimArrivals([n("a")], null)).toEqual([n("a")]);
    const broken = {
      getItem: () => "not json",
      setItem: () => undefined,
    };
    expect(claimArrivals([n("a")], broken)).toEqual([n("a")]);
  });

  it("keeps only the most recent 200 ids", () => {
    const storage = memoryStorage();
    claimArrivals(
      Array.from({ length: 250 }, (_, i) => n(`id-${i}`)),
      storage,
    );
    expect(JSON.parse(storage.getItem("opsdesk_sound_announced")!)).toHaveLength(200);
    expect(claimArrivals([n("id-0")], storage)).toEqual([n("id-0")]);
  });
});
