import { AlertNormalizationError, normalizeZabbixEvent } from "./normalize";
import type { ZabbixWebhookEvent } from "./types";

function baseEvent(overrides: Partial<ZabbixWebhookEvent> = {}): ZabbixWebhookEvent {
  return {
    eventId: "90431",
    eventValue: "1",
    name: "Disk predictive failure on {HOST.NAME}",
    nseverity: "4",
    severity: "High",
    timestamp: "1756808100", // 2025-09-02T10:15:00Z
    host: "SITE01-R01-SRV-038",
    hostName: "srv-038",
    itemKey: "smart.disk.health[2:1]",
    triggerId: "41233",
    tags: {
      site: "SITE01",
      ci: "SITE01-R01-SRV-038",
      component: "PhysicalDisk-2:1",
      alertType: "disk.predictive_failure",
    },
    ...overrides,
  };
}

describe("normalizeZabbixEvent", () => {
  it("maps a problem event onto the OpsDesk alert contract", () => {
    const result = normalizeZabbixEvent(baseEvent());

    expect(result).toMatchObject({
      eventId: "zbx-90431",
      source: "ZABBIX",
      siteCode: "SITE01",
      ciCode: "SITE01-R01-SRV-038",
      alertType: "disk.predictive_failure",
      severity: "HIGH",
      componentKey: "PhysicalDisk-2:1",
      state: "OPEN",
      occurredAt: "2025-09-02T10:15:00.000Z",
    });
    expect(result.attributes).toMatchObject({ zabbixEventId: "90431", host: "SITE01-R01-SRV-038" });
  });

  it("treats {EVENT.VALUE} '0' as a recovery on the same event id", () => {
    const result = normalizeZabbixEvent(baseEvent({ eventValue: "0", timestamp: "1756811700" }));

    expect(result.eventId).toBe("zbx-90431");
    expect(result.state).toBe("RECOVERED");
    expect(result.occurredAt).toBe("2025-09-02T11:15:00.000Z");
  });

  it("marks acknowledged updates as ACKNOWLEDGED", () => {
    expect(normalizeZabbixEvent(baseEvent({ eventAckStatus: "Yes" })).state).toBe("ACKNOWLEDGED");
    expect(normalizeZabbixEvent(baseEvent({ eventUpdateStatus: "1" })).state).toBe("ACKNOWLEDGED");
  });

  it("maps numeric severity 0..5", () => {
    const severities = ["0", "1", "2", "3", "4", "5"].map(
      (nseverity) => normalizeZabbixEvent(baseEvent({ nseverity })).severity,
    );
    expect(severities).toEqual(["INFO", "INFO", "WARNING", "HIGH", "HIGH", "CRITICAL"]);
  });

  it("falls back to textual severity when nseverity is absent", () => {
    expect(
      normalizeZabbixEvent(baseEvent({ nseverity: undefined, severity: "Disaster" })).severity,
    ).toBe("CRITICAL");
  });

  it("defaults unknown severity to WARNING", () => {
    expect(normalizeZabbixEvent(baseEvent({ nseverity: "  ", severity: "weird" })).severity).toBe(
      "WARNING",
    );
  });

  it("derives the site code from a host prefix when the site tag is missing", () => {
    const result = normalizeZabbixEvent(
      baseEvent({ tags: { ci: "SITE01-R01-SRV-038" }, host: "SITE07-R02-SW-001" }),
    );
    expect(result.siteCode).toBe("SITE07");
  });

  it("falls back for ciCode, alertType and componentKey", () => {
    const result = normalizeZabbixEvent(
      baseEvent({ tags: { site: "SITE01" }, itemKey: "net.if.status[eth0]" }),
    );
    expect(result.ciCode).toBe("SITE01-R01-SRV-038");
    expect(result.alertType).toBe("net.if.status[eth0]");
    expect(result.componentKey).toBe("net.if.status[eth0]");
  });

  it("slugifies the event name when no alertType tag or item key is present", () => {
    const result = normalizeZabbixEvent(
      baseEvent({
        tags: { site: "SITE01", ci: "CI-1" },
        itemKey: undefined,
        name: "CPU load too high!",
      }),
    );
    expect(result.alertType).toBe("cpu_load_too_high");
    expect(result.componentKey).toBeUndefined();
  });

  it("throws AlertNormalizationError with the offending field for missing required data", () => {
    expect(() => normalizeZabbixEvent(baseEvent({ eventId: "" }))).toThrow(AlertNormalizationError);
    expect(() => normalizeZabbixEvent(baseEvent({ host: "  " }))).toThrow(/host/);
    expect(() => normalizeZabbixEvent(baseEvent({ name: undefined }))).toThrow(/name/);

    try {
      normalizeZabbixEvent(baseEvent({ timestamp: "not-a-date" }));
      throw new Error("expected normalizeZabbixEvent to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(AlertNormalizationError);
      expect((err as AlertNormalizationError).field).toBe("timestamp");
    }
  });

  it("throws when neither a site tag nor a host prefix is available", () => {
    expect(() =>
      normalizeZabbixEvent(baseEvent({ tags: { ci: "CI-1" }, host: "standalone" })),
    ).toThrow(/site/);
  });
});
