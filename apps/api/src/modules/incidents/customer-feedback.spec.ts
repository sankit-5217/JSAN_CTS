import { IncidentStatus } from "@prisma/client";
import { currentCustomerFeedback } from "./customer-feedback";

const at = (minutes: number) => new Date(Date.UTC(2026, 9, 20, 10, minutes));

const statusChange = (to: IncidentStatus, minutes: number) => ({
  eventType: "STATUS_CHANGE",
  payload: { to },
  createdAt: at(minutes),
});

const feedback = (outcome: "FIXED" | "NOT_FIXED", minutes: number) => ({
  eventType: "CUSTOMER_FEEDBACK",
  payload: { outcome },
  createdAt: at(minutes),
});

describe("currentCustomerFeedback", () => {
  it("is null when the customer has not answered", () => {
    expect(currentCustomerFeedback([statusChange(IncidentStatus.RESOLVED, 0)])).toBeNull();
  });

  it("returns the customer's answer", () => {
    const result = currentCustomerFeedback([
      statusChange(IncidentStatus.RESOLVED, 0),
      feedback("FIXED", 30),
    ]);

    expect(result).toEqual({ outcome: "FIXED", at: at(30) });
  });

  it("keeps the latest answer when they have answered twice", () => {
    const result = currentCustomerFeedback([
      statusChange(IncidentStatus.RESOLVED, 0),
      feedback("NOT_FIXED", 30),
      feedback("FIXED", 60),
    ]);

    expect(result?.outcome).toBe("FIXED");
  });

  it("drops an answer when the desk resolves the ticket again", () => {
    // The customer said "not fixed"; the desk picked it up and resolved
    // it once more. That is a new fix, so the old answer no longer counts.
    const result = currentCustomerFeedback([
      statusChange(IncidentStatus.RESOLVED, 0),
      feedback("NOT_FIXED", 30),
      statusChange(IncidentStatus.REOPENED, 40),
      statusChange(IncidentStatus.RESOLVED, 50),
    ]);

    expect(result).toBeNull();
  });

  it("ignores other timeline events", () => {
    const result = currentCustomerFeedback([
      {
        eventType: "REPORT_EDITED",
        payload: { changes: [] },
        createdAt: at(10),
      },
      statusChange(IncidentStatus.ACKNOWLEDGED, 20),
    ]);

    expect(result).toBeNull();
  });
});
