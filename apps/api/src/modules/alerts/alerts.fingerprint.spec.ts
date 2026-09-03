import { computeAlertFingerprint } from "./alerts.fingerprint";

describe("computeAlertFingerprint", () => {
  const base = {
    siteCode: "SITE01",
    ciCode: "SITE01-R01-SRV-038",
    alertType: "disk.predictive_failure",
    componentKey: "PhysicalDisk-2:1",
  };

  it("is a 64-char lowercase hex sha256 digest", () => {
    expect(computeAlertFingerprint(base)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is stable across calls with the same inputs", () => {
    expect(computeAlertFingerprint(base)).toBe(computeAlertFingerprint({ ...base }));
  });

  it("ignores surrounding whitespace and case", () => {
    expect(computeAlertFingerprint(base)).toBe(
      computeAlertFingerprint({
        siteCode: " site01 ",
        ciCode: "SITE01-R01-SRV-038",
        alertType: "Disk.Predictive_Failure",
        componentKey: " physicaldisk-2:1 ",
      }),
    );
  });

  it("changes when the component differs", () => {
    expect(computeAlertFingerprint(base)).not.toBe(
      computeAlertFingerprint({ ...base, componentKey: "PhysicalDisk-3:1" }),
    );
  });

  it("changes when the alert type differs", () => {
    expect(computeAlertFingerprint(base)).not.toBe(
      computeAlertFingerprint({ ...base, alertType: "disk.smart_warning" }),
    );
  });

  it("treats a missing component the same as an empty one", () => {
    const withoutComponent = {
      siteCode: base.siteCode,
      ciCode: base.ciCode,
      alertType: base.alertType,
    };
    expect(computeAlertFingerprint(withoutComponent)).toBe(
      computeAlertFingerprint({ ...withoutComponent, componentKey: "" }),
    );
  });
});
