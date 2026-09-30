import { describe, expect, it } from "vitest";
import type { IncidentStatus } from "@cts-dc-opsdesk/shared-types";
import { isFinished, journeyStep, needsCustomer } from "./clientTicket";

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
