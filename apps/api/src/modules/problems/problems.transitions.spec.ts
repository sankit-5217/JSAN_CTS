import { canTransitionProblem, requiredFieldsForProblemStatus } from "./problems.transitions";

describe("canTransitionProblem", () => {
  it("allows the forward RCA path", () => {
    expect(canTransitionProblem("OPEN", "INVESTIGATING")).toBe(true);
    expect(canTransitionProblem("INVESTIGATING", "KNOWN_ERROR")).toBe(true);
    expect(canTransitionProblem("KNOWN_ERROR", "RESOLVED")).toBe(true);
    expect(canTransitionProblem("RESOLVED", "CLOSED")).toBe(true);
  });

  it("refuses to skip investigation", () => {
    expect(canTransitionProblem("OPEN", "RESOLVED")).toBe(false);
    expect(canTransitionProblem("OPEN", "KNOWN_ERROR")).toBe(false);
  });

  it("only re-opens a CLOSED problem into INVESTIGATING", () => {
    expect(canTransitionProblem("CLOSED", "INVESTIGATING")).toBe(true);
    expect(canTransitionProblem("CLOSED", "OPEN")).toBe(false);
    expect(canTransitionProblem("CLOSED", "RESOLVED")).toBe(false);
  });

  it("lets investigation resume from later states", () => {
    expect(canTransitionProblem("KNOWN_ERROR", "INVESTIGATING")).toBe(true);
    expect(canTransitionProblem("RESOLVED", "INVESTIGATING")).toBe(true);
  });
});

describe("requiredFieldsForProblemStatus", () => {
  it("requires a root cause before RESOLVED", () => {
    expect(requiredFieldsForProblemStatus("RESOLVED")).toEqual(["rootCause"]);
  });

  it("requires nothing for other states", () => {
    expect(requiredFieldsForProblemStatus("INVESTIGATING")).toEqual([]);
    expect(requiredFieldsForProblemStatus("CLOSED")).toEqual([]);
  });
});
