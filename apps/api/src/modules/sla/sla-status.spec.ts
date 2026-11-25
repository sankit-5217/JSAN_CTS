import { deriveSlaStatus, SlaStatusInput } from "./sla-status";

const T0 = new Date("2026-09-30T08:00:00Z");
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);

function instance(overrides: Partial<SlaStatusInput> = {}): SlaStatusInput {
  return {
    ackDueAt: at(30),
    ackedAt: null,
    resolveDueAt: at(240),
    resolvedAt: null,
    pausedAt: null,
    firedMilestones: [],
    ...overrides,
  };
}

describe("deriveSlaStatus", () => {
  it("is on track when nothing has fired and nothing is overdue", () => {
    const status = deriveSlaStatus(instance(), at(5));

    expect(status.response).toEqual({ state: "ON_TRACK", dueAt: at(30), completedAt: null });
    expect(status.resolution.state).toBe("ON_TRACK");
    expect(status.overall).toBe("ON_TRACK");
  });

  it("is at risk once a warning threshold has fired for that clock only", () => {
    const status = deriveSlaStatus(
      instance({ ackedAt: at(10), firedMilestones: ["RESOLVE_75"] }),
      at(200),
    );

    expect(status.response.state).toBe("MET");
    expect(status.resolution.state).toBe("AT_RISK");
    expect(status.overall).toBe("AT_RISK");
  });

  it("is breached when the breach milestone fired, or the due time passed before the scan", () => {
    expect(
      deriveSlaStatus(instance({ firedMilestones: ["ACK_50", "ACK_BREACH"] }), at(31)).response
        .state,
    ).toBe("BREACHED");
    expect(deriveSlaStatus(instance(), at(31)).response.state).toBe("BREACHED");
  });

  it("keeps a late acknowledgement as breached, and an on-time one as met", () => {
    expect(deriveSlaStatus(instance({ ackedAt: at(45) }), at(60)).response.state).toBe("BREACHED");
    expect(deriveSlaStatus(instance({ ackedAt: at(20) }), at(60)).response.state).toBe("MET");
  });

  it("reports a paused resolution clock without a due time", () => {
    const status = deriveSlaStatus(instance({ ackedAt: at(10), pausedAt: at(60) }), at(500));

    expect(status.resolution).toEqual({ state: "PAUSED", dueAt: null, completedAt: null });
    expect(status.overall).toBe("PAUSED");
  });

  it("stays breached through a pause", () => {
    const status = deriveSlaStatus(
      instance({ pausedAt: at(300), firedMilestones: ["RESOLVE_BREACH"] }),
      at(310),
    );

    expect(status.resolution.state).toBe("BREACHED");
  });

  it("is met overall when both clocks finished in time", () => {
    const status = deriveSlaStatus(instance({ ackedAt: at(10), resolvedAt: at(100) }), at(900));

    expect(status.overall).toBe("MET");
  });
});
