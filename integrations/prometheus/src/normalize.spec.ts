import {
  AlertNormalizationError,
  normalizeAlertmanagerAlert,
  normalizeAlertmanagerWebhook,
} from "./normalize";
import type { AlertmanagerAlert, AlertmanagerWebhook } from "./types";

function baseAlert(overrides: Partial<AlertmanagerAlert> = {}): AlertmanagerAlert {
  return {
    status: "firing",
    labels: {
      alertname: "NodeDiskPredictiveFailure",
      site: "SITE01",
      ci: "SITE01-R01-SRV-038",
      component: "sda",
      severity: "critical",
      instance: "10.20.1.38:9100",
    },
    annotations: {
      summary: "Disk sda on SITE01-R01-SRV-038 is predicted to fail",
    },
    startsAt: "2025-09-02T10:15:00.000Z",
    endsAt: "0001-01-01T00:00:00Z",
    fingerprint: "a1b2c3d4e5f60718",
    generatorURL: "http://prometheus.local/graph",
    ...overrides,
  };
}

function webhook(overrides: Partial<AlertmanagerWebhook> = {}): AlertmanagerWebhook {
  return {
    version: "4",
    status: "firing",
    alerts: [baseAlert()],
    ...overrides,
  };
}

describe("normalizeAlertmanagerAlert", () => {
  it("maps a firing alert onto the OpsDesk alert contract", () => {
    const result = normalizeAlertmanagerAlert(baseAlert());

    expect(result).toMatchObject({
      eventId: "prom-a1b2c3d4e5f60718-1756808100",
      source: "PROMETHEUS",
      siteCode: "SITE01",
      ciCode: "SITE01-R01-SRV-038",
      alertType: "NodeDiskPredictiveFailure",
      severity: "CRITICAL",
      componentKey: "sda",
      state: "OPEN",
      occurredAt: "2025-09-02T10:15:00.000Z",
    });
    expect(result.attributes).toMatchObject({ alertmanagerFingerprint: "a1b2c3d4e5f60718" });
  });

  it("maps a resolved alert to RECOVERED using endsAt, keeping the same event id", () => {
    const firing = normalizeAlertmanagerAlert(baseAlert());
    const resolved = normalizeAlertmanagerAlert(
      baseAlert({ status: "resolved", endsAt: "2025-09-02T11:15:00.000Z" }),
    );

    expect(resolved.eventId).toBe(firing.eventId);
    expect(resolved.state).toBe("RECOVERED");
    expect(resolved.occurredAt).toBe("2025-09-02T11:15:00.000Z");
  });

  it("maps severity labels and defaults unknown values to WARNING", () => {
    const sev = (severity: string) =>
      normalizeAlertmanagerAlert(baseAlert({ labels: { ...baseAlert().labels, severity } }))
        .severity;

    expect(sev("critical")).toBe("CRITICAL");
    expect(sev("warning")).toBe("WARNING");
    expect(sev("info")).toBe("INFO");
    expect(sev("banana")).toBe("WARNING");
  });

  it("falls back for componentKey: component -> device -> instance -> undefined", () => {
    const withDevice = normalizeAlertmanagerAlert(
      baseAlert({
        labels: {
          alertname: "X",
          site: "SITE01",
          ci: "CI-1",
          device: "eth0",
          instance: "host:9100",
        },
      }),
    );
    expect(withDevice.componentKey).toBe("eth0");

    const withInstanceOnly = normalizeAlertmanagerAlert(
      baseAlert({ labels: { alertname: "X", site: "SITE01", ci: "CI-1", instance: "host:9100" } }),
    );
    expect(withInstanceOnly.componentKey).toBe("host:9100");

    const withNone = normalizeAlertmanagerAlert(
      baseAlert({ labels: { alertname: "X", site: "SITE01", ci: "CI-1" } }),
    );
    expect(withNone.componentKey).toBeUndefined();
  });

  it("throws AlertNormalizationError with the offending label", () => {
    expect(() =>
      normalizeAlertmanagerAlert(baseAlert({ labels: { site: "SITE01", ci: "CI-1" } })),
    ).toThrow(/alertname/);

    try {
      normalizeAlertmanagerAlert(baseAlert({ labels: { alertname: "X", ci: "CI-1" } }), 3);
      throw new Error("expected normalizeAlertmanagerAlert to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(AlertNormalizationError);
      expect((err as AlertNormalizationError).field).toBe("site");
      expect((err as AlertNormalizationError).index).toBe(3);
    }
  });

  it("throws for an unparseable startsAt", () => {
    expect(() => normalizeAlertmanagerAlert(baseAlert({ startsAt: "yesterday" }))).toThrow(
      /startsAt/,
    );
  });
});

describe("normalizeAlertmanagerWebhook", () => {
  it("normalizes every alert in the delivery", () => {
    const result = normalizeAlertmanagerWebhook(
      webhook({
        alerts: [
          baseAlert(),
          baseAlert({
            fingerprint: "ffffffffffffffff",
            labels: { ...baseAlert().labels, ci: "CI-2" },
          }),
        ],
      }),
    );

    expect(result.normalized).toHaveLength(2);
    expect(result.errors).toHaveLength(0);
  });

  it("collects per-alert errors without dropping the good ones", () => {
    const result = normalizeAlertmanagerWebhook(
      webhook({
        alerts: [
          baseAlert(),
          baseAlert({ labels: { alertname: "Broken", ci: "CI-2" } }), // no site label
        ],
      }),
    );

    expect(result.normalized).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toBeInstanceOf(AlertNormalizationError);
    expect(result.errors[0].field).toBe("site");
    expect(result.errors[0].index).toBe(1);
  });

  it("throws when the envelope has no alerts array", () => {
    expect(() =>
      normalizeAlertmanagerWebhook({ version: "4", status: "firing" } as AlertmanagerWebhook),
    ).toThrow(/alerts/);
  });
});
