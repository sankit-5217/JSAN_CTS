import { allowedRiskTransitions, canTransitionRiskStatus } from "./risks.transitions";

describe("canTransitionRiskStatus", () => {
  it("only OPEN is reachable from nothing (creation)", () => {
    expect(canTransitionRiskStatus(null, "OPEN")).toBe(true);
    expect(canTransitionRiskStatus(null, "MITIGATING")).toBe(false);
  });

  it("allows the forward lifecycle", () => {
    expect(canTransitionRiskStatus("OPEN", "MITIGATING")).toBe(true);
    expect(canTransitionRiskStatus("MITIGATING", "ACCEPTED")).toBe(true);
    expect(canTransitionRiskStatus("MITIGATING", "CLOSED")).toBe(true);
    expect(canTransitionRiskStatus("ACCEPTED", "CLOSED")).toBe(true);
  });

  it("allows re-opening from any terminal-ish state", () => {
    expect(canTransitionRiskStatus("ACCEPTED", "OPEN")).toBe(true);
    expect(canTransitionRiskStatus("CLOSED", "OPEN")).toBe(true);
  });

  it("rejects a no-op and skipping straight from CLOSED to ACCEPTED", () => {
    expect(canTransitionRiskStatus("OPEN", "OPEN")).toBe(false);
    expect(canTransitionRiskStatus("CLOSED", "ACCEPTED")).toBe(false);
  });
});

describe("allowedRiskTransitions", () => {
  it("lists the reachable states", () => {
    expect(allowedRiskTransitions("OPEN")).toEqual(["MITIGATING", "ACCEPTED", "CLOSED"]);
    expect(allowedRiskTransitions("CLOSED")).toEqual(["OPEN"]);
  });
});
