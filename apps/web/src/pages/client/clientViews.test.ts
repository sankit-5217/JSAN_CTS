import { describe, expect, it } from "vitest";
import type { IncidentStatus } from "@cts-dc-opsdesk/shared-types";
import {
  confirmedFixed,
  isOpen,
  isResolved,
  matchesView,
  needsYou,
  type ClientViewTicket,
} from "./clientViews";

// Statuses arrive from the API as plain strings, same as here.
const s = (status: string) => status as IncidentStatus;
const ticket = (
  status: string,
  feedback: ClientViewTicket["feedback"] = null,
): ClientViewTicket => ({ id: "inc-1", status: s(status), feedback });

const FIXED = { outcome: "FIXED" as const, at: "2026-10-20T10:00:00.000Z" };
const NOT_FIXED = { outcome: "NOT_FIXED" as const, at: "2026-10-20T10:00:00.000Z" };

describe("needsYou", () => {
  it("is true when the desk is waiting on the customer to reply", () => {
    expect(needsYou(ticket("PENDING_CUSTOMER"))).toBe(true);
  });

  it("is true for a resolved ticket the customer has not confirmed yet", () => {
    expect(needsYou(ticket("RESOLVED"))).toBe(true);
  });

  it("is false once the customer has confirmed the fix", () => {
    expect(needsYou(ticket("RESOLVED", FIXED))).toBe(false);
  });

  it("is false while the desk is working on it", () => {
    expect(needsYou(ticket("IN_PROGRESS"))).toBe(false);
    expect(needsYou(ticket("PENDING_VENDOR"))).toBe(false);
  });
});

describe("confirmedFixed", () => {
  it("is true only for a FIXED answer", () => {
    expect(confirmedFixed(ticket("CLOSED", FIXED))).toBe(true);
    expect(confirmedFixed(ticket("RESOLVED", NOT_FIXED))).toBe(false);
    expect(confirmedFixed(ticket("CLOSED"))).toBe(false);
  });
});

describe("isOpen / isResolved", () => {
  it("treats a resolved ticket as resolved, not open", () => {
    // RESOLVED is the platform's "fix delivered, awaiting the customer's
    // confirmation" state — it has left the open queue (the same rule
    // the Command Center and the site open-issue counts use).
    expect(isOpen(ticket("RESOLVED"))).toBe(false);
    expect(isResolved(ticket("RESOLVED"))).toBe(true);
  });

  it("treats a closed ticket as resolved and not open", () => {
    expect(isOpen(ticket("CLOSED"))).toBe(false);
    expect(isResolved(ticket("CLOSED"))).toBe(true);
  });

  it("treats a cancelled or duplicate ticket as neither open nor resolved", () => {
    expect(isOpen(ticket("CANCELLED"))).toBe(false);
    expect(isResolved(ticket("CANCELLED"))).toBe(false);
    expect(isOpen(ticket("DUPLICATE"))).toBe(false);
    expect(isResolved(ticket("DUPLICATE"))).toBe(false);
  });
});

describe("matchesView", () => {
  it("Reported by Me shows every ticket", () => {
    expect(matchesView(ticket("NEW"), "reported")).toBe(true);
    expect(matchesView(ticket("CLOSED", FIXED), "reported")).toBe(true);
  });

  it("Assigned to Me shows only what is waiting on the customer", () => {
    expect(matchesView(ticket("PENDING_CUSTOMER"), "assigned")).toBe(true);
    expect(matchesView(ticket("RESOLVED"), "assigned")).toBe(true);
    expect(matchesView(ticket("RESOLVED", FIXED), "assigned")).toBe(false);
    expect(matchesView(ticket("IN_PROGRESS"), "assigned")).toBe(false);
  });

  it("Resolved by Me shows the tickets the customer confirmed", () => {
    expect(matchesView(ticket("CLOSED", FIXED), "resolved")).toBe(true);
    expect(matchesView(ticket("RESOLVED", FIXED), "resolved")).toBe(true);
    expect(matchesView(ticket("CLOSED", NOT_FIXED), "resolved")).toBe(false);
    expect(matchesView(ticket("CLOSED"), "resolved")).toBe(false);
  });

  it("All Open Tickets shows everything still being worked on", () => {
    expect(matchesView(ticket("NEW"), "open")).toBe(true);
    expect(matchesView(ticket("IN_PROGRESS"), "open")).toBe(true);
    expect(matchesView(ticket("PENDING_CUSTOMER"), "open")).toBe(true);
    expect(matchesView(ticket("CLOSED"), "open")).toBe(false);
    // Resolved has left the open queue — it's awaiting the customer's
    // confirmation, and it shows under "All Resolved Tickets".
    expect(matchesView(ticket("RESOLVED"), "open")).toBe(false);
  });

  it("All Resolved Tickets shows everything that reached a fix", () => {
    expect(matchesView(ticket("RESOLVED"), "resolved-all")).toBe(true);
    expect(matchesView(ticket("CLOSED"), "resolved-all")).toBe(true);
    expect(matchesView(ticket("NEW"), "resolved-all")).toBe(false);
  });

  it("keeps the views disjoint where their names promise it", () => {
    const open = ticket("IN_PROGRESS");
    const resolved = ticket("CLOSED", FIXED);
    expect(matchesView(open, "open")).toBe(true);
    expect(matchesView(open, "resolved-all")).toBe(false);
    expect(matchesView(resolved, "resolved-all")).toBe(true);
    expect(matchesView(resolved, "open")).toBe(false);
  });
});
