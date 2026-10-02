import { useEffect, useMemo, useState } from "react";
import { apiGet } from "../../api/client";

/** GET /reports/client-portal (ClientPortalService.getOverview). */
export type SlaClockState = "ON_TRACK" | "AT_RISK" | "BREACHED" | "PAUSED" | "MET";

export interface SlaClock {
  state: SlaClockState;
  dueAt: string | null;
  completedAt: string | null;
}

export interface SlaStatus {
  response: SlaClock;
  resolution: SlaClock;
  overall: SlaClockState;
}

export type SiteState = "NO_OPEN_ISSUES" | "ISSUE_IN_PROGRESS" | "MAJOR_INCIDENT";
export type DutyState = "ON_SHIFT" | "ON_CALL";

export interface PortalContact {
  name: string;
  role: string;
  phone: string | null;
  email: string | null;
  isOnCall: boolean;
}

export interface PortalTeamMember {
  name: string;
  duty: DutyState;
  shiftLabel: string;
  tickets: { id: string; incidentNo: string; shortDescription: string }[];
}

export interface PortalSite {
  id: string;
  code: string;
  name: string;
  state: SiteState;
  openIssues: number;
  contacts: PortalContact[];
  team: PortalTeamMember[];
}

export interface PortalTicket {
  id: string;
  siteId: string;
  sla: SlaStatus | null;
  activity: {
    engineer: string | null;
    duty: DutyState | "OFF_DUTY" | null;
    workingNow: { engineer: string; since: string } | null;
  };
}

export interface PortalOverview {
  asOf: string;
  sites: PortalSite[];
  tickets: PortalTicket[];
}

type ChipColor = "info" | "warning" | "success" | "default" | "error";

export const SLA_LABEL: Record<SlaClockState, string> = {
  ON_TRACK: "On track",
  AT_RISK: "At risk",
  BREACHED: "Target missed",
  PAUSED: "Paused",
  MET: "Target met",
};

export const SLA_COLOR: Record<SlaClockState, ChipColor> = {
  ON_TRACK: "success",
  AT_RISK: "warning",
  BREACHED: "error",
  PAUSED: "default",
  MET: "success",
};

export const SITE_STATE_LABEL: Record<SiteState, string> = {
  NO_OPEN_ISSUES: "No open issues",
  ISSUE_IN_PROGRESS: "Issue in progress",
  MAJOR_INCIDENT: "Major incident",
};

export const SITE_STATE_COLOR: Record<SiteState, ChipColor> = {
  NO_OPEN_ISSUES: "success",
  ISSUE_IN_PROGRESS: "warning",
  MAJOR_INCIDENT: "error",
};

export const DUTY_LABEL: Record<DutyState | "OFF_DUTY", string> = {
  ON_SHIFT: "On shift",
  ON_CALL: "On call",
  OFF_DUTY: "Off shift",
};

/** "today, 4:30 PM" / "Thu 2 Oct, 4:30 PM": a target time a customer can
 *  read at a glance without doing date arithmetic. */
export function formatDue(iso: string, now = new Date()): string {
  const due = new Date(iso);
  const time = due.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (due.toDateString() === now.toDateString()) {
    return `today, ${time}`;
  }
  const day = due.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
  return `${day}, ${time}`;
}

/** One line for a clock: what the target is and where it stands. */
export function describeClock(kind: "response" | "resolution", clock: SlaClock): string {
  const verb = kind === "response" ? "Respond" : "Resolve";
  const done = kind === "response" ? "Responded" : "Resolved";
  if (clock.completedAt) {
    return `${done} ${formatDue(clock.completedAt)}`;
  }
  if (clock.state === "PAUSED") {
    return "Clock paused while we wait on a reply or a vendor";
  }
  return clock.dueAt ? `${verb} by ${formatDue(clock.dueAt)}` : "No target set";
}

/** The live "who's on it" line under a ticket, or null when unassigned. */
export function describeActivity(
  activity: PortalTicket["activity"],
  since: (iso: string) => string,
) {
  if (activity.workingNow) {
    return `${activity.workingNow.engineer} is working on this now (started ${since(activity.workingNow.since)})`;
  }
  if (!activity.engineer || !activity.duty) {
    return null;
  }
  return activity.duty === "OFF_DUTY"
    ? `${activity.engineer} is off shift right now; the on-duty team is covering`
    : `${activity.engineer} is ${DUTY_LABEL[activity.duty].toLowerCase()} now`;
}

// The roster and SLA badges change on their own as shifts roll over and
// clocks run, so the overview refreshes while the tab is in view.
const POLL_INTERVAL_MS = 30_000;

export function useClientPortal() {
  const [overview, setOverview] = useState<PortalOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      if (document.visibilityState !== "visible") return;
      apiGet<PortalOverview>("/reports/client-portal")
        .then((res) => {
          if (cancelled) return;
          setOverview(res);
          setError(null);
        })
        .catch((err: Error) => !cancelled && setError(err.message));
    };
    load();
    const timer = window.setInterval(load, POLL_INTERVAL_MS);
    document.addEventListener("visibilitychange", load);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", load);
    };
  }, []);

  const ticketsById = useMemo(
    () => new Map((overview?.tickets ?? []).map((t) => [t.id, t])),
    [overview],
  );

  return { overview, ticketsById, error };
}
