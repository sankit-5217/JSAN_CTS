import { describe, expect, it } from "vitest";
import type { IncidentStatus } from "@cts-dc-opsdesk/shared-types";
import { buildConversation, isFinished, journeyStep, needsCustomer } from "./clientTicket";

// Statuses arrive from the API as plain strings, same as here.
const s = (status: `${IncidentStatus}`) => status as IncidentStatus;
const m = (...statuses: `${IncidentStatus}`[]) => statuses.map((status) => ({ status: s(status) }));

describe("journeyStep", () => {
  it("follows the ticket forward", () => {
    expect(journeyStep(m("NEW"))).toBe(0);
    expect(journeyStep(m("NEW", "ASSIGNED"))).toBe(1);
    expect(journeyStep(m("NEW", "ASSIGNED", "ACKNOWLEDGED"))).toBe(2);
    expect(journeyStep(m("NEW", "ASSIGNED", "IN_PROGRESS", "RESOLVED"))).toBe(3);
  });

  it("stays on 'being worked on' while waiting on the customer or a vendor", () => {
    expect(journeyStep(m("NEW", "IN_PROGRESS", "PENDING_CUSTOMER"))).toBe(2);
  });

  it("drops back to 'being worked on' when reopened", () => {
    expect(journeyStep(m("NEW", "RESOLVED", "REOPENED"))).toBe(2);
    expect(journeyStep(m("NEW", "RESOLVED", "REOPENED", "IN_PROGRESS", "RESOLVED"))).toBe(3);
  });
});

describe("status groups", () => {
  it("flags what needs the customer", () => {
    expect(needsCustomer(s("PENDING_CUSTOMER"))).toBe(true);
    expect(needsCustomer(s("RESOLVED"))).toBe(true);
    expect(needsCustomer(s("IN_PROGRESS"))).toBe(false);
    expect(needsCustomer(s("PENDING_VENDOR"))).toBe(false);
  });

  it("treats closed and cancelled as finished", () => {
    expect(isFinished(s("CLOSED"))).toBe(true);
    expect(isFinished(s("CANCELLED"))).toBe(true);
    expect(isFinished(s("RESOLVED"))).toBe(false);
  });
});

describe("buildConversation", () => {
  const msg = (id: string, createdAt: string) => ({ id, createdAt });
  const progress = {
    milestones: [
      { status: "NEW" as IncidentStatus, at: "2026-10-15T09:00:00.000Z" },
      { status: "ASSIGNED" as IncidentStatus, at: "2026-10-15T09:10:00.000Z" },
    ],
    reportEdits: [
      {
        at: "2026-10-15T09:05:00.000Z",
        by: { name: "Priya", role: "CLIENT_MANAGER_VIEWER" },
        detailed: true,
        changes: [{ label: "Priority", from: "P3", to: "P2" }],
      },
      { at: "2026-10-15T09:06:00.000Z", by: null, detailed: true, changes: [] },
    ],
  };

  it("puts messages, status changes and report edits in time order", () => {
    const items = buildConversation(
      [msg("m2", "2026-10-15T09:20:00.000Z"), msg("m1", "2026-10-15T09:01:00.000Z")],
      progress,
    );
    expect(items.map((i) => i.type)).toEqual(["comment", "edit", "status", "comment"]);
    expect(items[1]).toMatchObject({ type: "edit", edit: { changes: [{ from: "P3", to: "P2" }] } });
  });

  it("skips the creation milestone and empty edits", () => {
    const items = buildConversation([], progress);
    expect(items.filter((i) => i.type === "status")).toHaveLength(1);
    expect(items.filter((i) => i.type === "edit")).toHaveLength(1);
  });

  it("sorts by actual time even when offsets differ", () => {
    const items = buildConversation(
      [msg("late", "2026-10-15T15:00:00+05:30"), msg("early", "2026-10-15T09:20:00.000Z")],
      null,
    );
    // 15:00 IST is 09:30 UTC, after 09:20 UTC
    expect(items.map((i) => (i.type === "comment" ? i.comment.id : ""))).toEqual(["early", "late"]);
  });

  it("can leave status lines out (staff page shows them elsewhere)", () => {
    expect(buildConversation([], progress, { statuses: false }).map((i) => i.type)).toEqual([
      "edit",
    ]);
  });

  describe("report edits: one box per run of the same person's edits", () => {
    const edit = (at: string, email: string, label: string, from: string, to: string) => ({
      at,
      by: { name: email, email, role: null },
      detailed: true,
      changes: [{ label, from, to }],
    });
    const run = (
      edits: ReturnType<typeof edit>[],
      comments: { id: string; createdAt: string }[] = [],
    ) => buildConversation(comments, { milestones: [], reportEdits: edits });

    it("merges back-to-back edits by the same person, first old value to last new one", () => {
      const items = run([
        edit("2026-10-15T09:01:00.000Z", "priya@client.example", "Priority", "P3", "P2"),
        edit("2026-10-15T09:02:00.000Z", "priya@client.example", "Severity", "Low", "High"),
        edit("2026-10-15T09:03:00.000Z", "priya@client.example", "Priority", "P2", "P1"),
      ]);
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        type: "edit",
        at: "2026-10-15T09:03:00.000Z",
        edit: {
          changes: [
            { label: "Priority", from: "P3", to: "P1" },
            { label: "Severity", from: "Low", to: "High" },
          ],
        },
      });
    });

    it("starts a new box when someone else edits", () => {
      const items = run([
        edit("2026-10-15T09:01:00.000Z", "priya@client.example", "Priority", "P3", "P2"),
        edit("2026-10-15T09:02:00.000Z", "desk@jsan.example", "Priority", "P2", "P1"),
        edit("2026-10-15T09:03:00.000Z", "priya@client.example", "Severity", "Low", "High"),
      ]);
      expect(items.map((i) => (i.type === "edit" ? i.edit.by?.email : ""))).toEqual([
        "priya@client.example",
        "desk@jsan.example",
        "priya@client.example",
      ]);
    });

    it("starts a new box when a message comes between", () => {
      const items = run(
        [
          edit("2026-10-15T09:01:00.000Z", "priya@client.example", "Priority", "P3", "P2"),
          edit("2026-10-15T09:03:00.000Z", "priya@client.example", "Severity", "Low", "High"),
        ],
        [{ id: "m1", createdAt: "2026-10-15T09:02:00.000Z" }],
      );
      expect(items.map((i) => i.type)).toEqual(["edit", "comment", "edit"]);
    });
  });
});
