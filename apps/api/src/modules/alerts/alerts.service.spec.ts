import { NotFoundException } from "@nestjs/common";
import { NotificationsPublisher } from "../../common/notifications/notifications.publisher";
import { PrismaService } from "../../common/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { ChangesService } from "../changes/changes.service";
import { IncidentsService } from "../incidents/incidents.service";
import { AlertRulesService } from "./alert-rules.service";
import { DEFAULT_ALERT_RULE } from "./alerts.constants";
import { AlertsService } from "./alerts.service";
import { AlertmanagerWebhookDto } from "./dto/alertmanager-webhook.dto";
import { IngestAlertDto } from "./dto/ingest-alert.dto";
import { ZabbixWebhookEventDto } from "./dto/zabbix-webhook.dto";

type PrismaMock = {
  site: { findUnique: jest.Mock };
  configurationItem: { findUnique: jest.Mock };
  user: { findMany: jest.Mock };
  alert: {
    findUnique: jest.Mock;
    findMany: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    count: jest.Mock;
  };
  $transaction: jest.Mock;
};

function createPrismaMock(): PrismaMock {
  const mock: PrismaMock = {
    site: { findUnique: jest.fn() },
    configurationItem: { findUnique: jest.fn() },
    user: { findMany: jest.fn() },
    alert: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    $transaction: jest.fn(),
  };
  // The callback gets the mock itself standing in as the transaction client.
  mock.$transaction.mockImplementation((fn: (tx: PrismaMock) => unknown) => fn(mock));
  return mock;
}

function baseDto(overrides: Partial<IngestAlertDto> = {}): IngestAlertDto {
  return {
    eventId: "zbx-evt-1",
    source: "ZABBIX",
    siteCode: "SITE01",
    ciCode: "SITE01-R01-SRV-038",
    alertType: "disk.predictive_failure",
    severity: "HIGH",
    componentKey: "PhysicalDisk-2:1",
    occurredAt: "2026-09-02T10:15:00.000Z",
    state: "OPEN",
    summary: "Predictive failure on physical disk 2:1",
    ...overrides,
  };
}

const ACTOR = { actorId: "collector-svc", correlationId: "corr-1" };

describe("AlertsService", () => {
  let prisma: PrismaMock;
  let audit: { record: jest.Mock };
  let notifications: { enqueue: jest.Mock };
  let incidents: { findOpenByCi: jest.Mock; linkAlert: jest.Mock };
  let alertRules: { getActiveRule: jest.Mock };
  let changes: { getActiveMaintenanceWindows: jest.Mock };
  let service: AlertsService;

  beforeEach(() => {
    prisma = createPrismaMock();
    audit = { record: jest.fn() };
    notifications = { enqueue: jest.fn() };
    incidents = {
      findOpenByCi: jest.fn().mockResolvedValue(null),
      linkAlert: jest.fn().mockResolvedValue({ linked: true }),
    };
    alertRules = { getActiveRule: jest.fn().mockResolvedValue({ ...DEFAULT_ALERT_RULE }) };
    changes = { getActiveMaintenanceWindows: jest.fn().mockResolvedValue([]) };
    service = new AlertsService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
      notifications as unknown as NotificationsPublisher,
      incidents as unknown as IncidentsService,
      alertRules as unknown as AlertRulesService,
      changes as unknown as ChangesService,
    );
    prisma.site.findUnique.mockResolvedValue({ id: "site-1", code: "SITE01" });
    prisma.configurationItem.findUnique.mockResolvedValue({
      id: "ci-1",
      ciCode: "SITE01-R01-SRV-038",
      siteId: "site-1",
    });
    prisma.alert.count.mockResolvedValue(1);
  });

  it("creates a new alert when (source, eventId) is unseen", async () => {
    prisma.alert.findUnique.mockResolvedValue(null);
    prisma.alert.create.mockResolvedValue({ id: "alert-1", state: "OPEN" });

    const result = await service.ingest(baseDto(), ACTOR);

    expect(result.deduped).toBe(false);
    expect(result.alertId).toBe("alert-1");
    expect(result.siteResolved).toBe(true);
    expect(result.ciResolved).toBe(true);

    const data = prisma.alert.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      externalEventId: "zbx-evt-1",
      source: "ZABBIX",
      siteId: "site-1",
      ciId: "ci-1",
      state: "OPEN",
    });
    expect(data.firstSeenAt).toEqual(new Date("2026-09-02T10:15:00.000Z"));
    expect(data.lastSeenAt).toEqual(new Date("2026-09-02T10:15:00.000Z"));
    expect(data.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: "alert", action: "ALERT_RAISED" }),
      prisma,
    );
  });

  it("dedupes on a repeat (source, eventId) and advances lastSeenAt", async () => {
    prisma.alert.findUnique.mockResolvedValue({
      id: "alert-1",
      state: "OPEN",
      siteId: "site-1",
      ciId: "ci-1",
      lastSeenAt: new Date("2026-09-02T09:00:00.000Z"),
    });
    prisma.alert.update.mockResolvedValue({ id: "alert-1", state: "OPEN" });

    const result = await service.ingest(baseDto(), ACTOR);

    expect(result.deduped).toBe(true);
    expect(result.stateChanged).toBe(false);
    expect(prisma.alert.create).not.toHaveBeenCalled();
    // a plain dedup / lastSeenAt bump is not a state change — no audit row
    expect(audit.record).not.toHaveBeenCalled();

    const data = prisma.alert.update.mock.calls[0][0].data;
    expect(data.lastSeenAt).toEqual(new Date("2026-09-02T10:15:00.000Z"));
    expect(data.state).toBe("OPEN");
  });

  it("keeps the later lastSeenAt when an out-of-order event arrives", async () => {
    prisma.alert.findUnique.mockResolvedValue({
      id: "alert-1",
      state: "OPEN",
      siteId: "site-1",
      ciId: "ci-1",
      lastSeenAt: new Date("2026-09-02T12:00:00.000Z"),
    });
    prisma.alert.update.mockResolvedValue({ id: "alert-1", state: "OPEN" });

    await service.ingest(baseDto({ occurredAt: "2026-09-02T10:15:00.000Z" }), ACTOR);

    const data = prisma.alert.update.mock.calls[0][0].data;
    expect(data.lastSeenAt).toEqual(new Date("2026-09-02T12:00:00.000Z"));
  });

  it("applies the OPEN -> RECOVERED transition on a recovery event", async () => {
    prisma.alert.findUnique.mockResolvedValue({
      id: "alert-1",
      state: "OPEN",
      siteId: "site-1",
      ciId: "ci-1",
      lastSeenAt: new Date("2026-09-02T09:00:00.000Z"),
    });
    prisma.alert.update.mockResolvedValue({ id: "alert-1", state: "RECOVERED" });

    const result = await service.ingest(baseDto({ state: "RECOVERED" }), ACTOR);

    expect(result.stateChanged).toBe(true);
    expect(prisma.alert.update.mock.calls[0][0].data.state).toBe("RECOVERED");
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: "alert",
        action: "ALERT_STATE_CHANGED",
        before: expect.objectContaining({ state: "OPEN" }),
        after: expect.objectContaining({ state: "RECOVERED" }),
      }),
      prisma,
    );
  });

  it("does not regress a RECOVERED alert back to OPEN", async () => {
    prisma.alert.findUnique.mockResolvedValue({
      id: "alert-1",
      state: "RECOVERED",
      siteId: "site-1",
      ciId: "ci-1",
      lastSeenAt: new Date("2026-09-02T09:00:00.000Z"),
    });
    prisma.alert.update.mockResolvedValue({ id: "alert-1", state: "RECOVERED" });

    const result = await service.ingest(baseDto({ state: "OPEN" }), ACTOR);

    expect(result.stateChanged).toBe(false);
    expect(prisma.alert.update.mock.calls[0][0].data.state).toBe("RECOVERED");
  });

  it("stores the alert unresolved when site and CI codes are unknown", async () => {
    prisma.site.findUnique.mockResolvedValue(null);
    prisma.configurationItem.findUnique.mockResolvedValue(null);
    prisma.alert.findUnique.mockResolvedValue(null);
    prisma.alert.create.mockResolvedValue({ id: "alert-2", state: "OPEN" });

    const result = await service.ingest(baseDto({ siteCode: "GHOST", ciCode: "GHOST-CI" }), ACTOR);

    expect(result.siteResolved).toBe(false);
    expect(result.ciResolved).toBe(false);

    const data = prisma.alert.create.mock.calls[0][0].data;
    expect(data.siteId).toBeNull();
    expect(data.ciId).toBeNull();
  });

  it("flags flapping when the fingerprint recurs past the threshold", async () => {
    prisma.alert.findUnique.mockResolvedValue(null);
    prisma.alert.create.mockResolvedValue({ id: "alert-3", state: "OPEN" });
    prisma.alert.count.mockResolvedValue(5);

    const result = await service.ingest(baseDto(), ACTOR);

    expect(result.flapping).toBe(true);
    expect(result.recentOccurrences).toBe(5);
  });

  it("flags suppressedByMaintenance when the linked CI is in MAINTENANCE lifecycle", async () => {
    prisma.configurationItem.findUnique.mockResolvedValue({
      id: "ci-1",
      ciCode: "SITE01-R01-SRV-038",
      siteId: "site-1",
      lifecycleStatus: "MAINTENANCE",
    });
    prisma.alert.findUnique.mockResolvedValue(null);
    prisma.alert.create.mockResolvedValue({ id: "alert-4", state: "OPEN" });

    const result = await service.ingest(baseDto(), ACTOR);

    expect(result.suppressedByMaintenance).toBe(true);
    // the alert is still recorded, just annotated
    expect(prisma.alert.create).toHaveBeenCalledTimes(1);
  });

  it("does not flag suppression for an ACTIVE CI", async () => {
    prisma.configurationItem.findUnique.mockResolvedValue({
      id: "ci-1",
      ciCode: "SITE01-R01-SRV-038",
      siteId: "site-1",
      lifecycleStatus: "ACTIVE",
    });
    prisma.alert.findUnique.mockResolvedValue(null);
    prisma.alert.create.mockResolvedValue({ id: "alert-5", state: "OPEN" });

    const result = await service.ingest(baseDto(), ACTOR);

    expect(result.suppressedByMaintenance).toBe(false);
  });

  describe("maintenance-window suppression (§10.10 rule 5)", () => {
    it("suppresses ticketing when the CI is under an approved change window", async () => {
      changes.getActiveMaintenanceWindows.mockResolvedValue([{ id: "chg-1" }]);
      incidents.findOpenByCi.mockResolvedValue({ id: "inc-7", incidentNo: "INC-000007" });
      prisma.alert.findUnique.mockResolvedValue(null);
      prisma.alert.create.mockResolvedValue({ id: "alert-m", state: "OPEN" });
      prisma.user.findMany.mockResolvedValue([{ email: "noc@corp.example", displayName: "NOC" }]);

      const result = await service.ingest(baseDto({ severity: "CRITICAL" }), ACTOR);

      expect(changes.getActiveMaintenanceWindows).toHaveBeenCalledWith(expect.any(Date), "ci-1");
      expect(result.suppressedByMaintenance).toBe(true);
      expect(result.autoTicketSuppressed).toBe(true);
      expect(result.correlatedIncidentId).toBeNull();
      expect(incidents.linkAlert).not.toHaveBeenCalled();
      expect(notifications.enqueue).not.toHaveBeenCalled();
    });

    it("only labels (still correlates + pages) when the rule says label-not-suppress", async () => {
      alertRules.getActiveRule.mockResolvedValue({
        ...DEFAULT_ALERT_RULE,
        suppressAutoTicketDuringMaintenance: false,
      });
      changes.getActiveMaintenanceWindows.mockResolvedValue([{ id: "chg-1" }]);
      incidents.findOpenByCi.mockResolvedValue({ id: "inc-7", incidentNo: "INC-000007" });
      prisma.alert.findUnique.mockResolvedValue(null);
      prisma.alert.create.mockResolvedValue({ id: "alert-m2", state: "OPEN" });
      prisma.user.findMany.mockResolvedValue([{ email: "noc@corp.example", displayName: "NOC" }]);

      const result = await service.ingest(baseDto({ severity: "CRITICAL" }), ACTOR);

      expect(result.suppressedByMaintenance).toBe(true);
      expect(result.autoTicketSuppressed).toBe(false);
      expect(result.correlatedIncidentId).toBe("inc-7");
      expect(notifications.enqueue).toHaveBeenCalledTimes(1);
    });

    it("never fails ingestion when the maintenance-window check throws", async () => {
      changes.getActiveMaintenanceWindows.mockRejectedValue(new Error("changes down"));
      prisma.alert.findUnique.mockResolvedValue(null);
      prisma.alert.create.mockResolvedValue({ id: "alert-m3", state: "OPEN" });

      const result = await service.ingest(baseDto(), ACTOR);

      expect(result.alertId).toBe("alert-m3");
      expect(result.suppressedByMaintenance).toBe(false);
    });
  });

  describe("incident correlation", () => {
    it("links a new alert to a still-open incident on the same CI", async () => {
      prisma.alert.findUnique.mockResolvedValue(null);
      prisma.alert.create.mockResolvedValue({ id: "alert-c", state: "OPEN" });
      incidents.findOpenByCi.mockResolvedValue({ id: "inc-7", incidentNo: "INC-000007" });

      const result = await service.ingest(baseDto(), ACTOR);

      expect(incidents.findOpenByCi).toHaveBeenCalledWith("ci-1");
      expect(incidents.linkAlert).toHaveBeenCalledWith(
        "inc-7",
        expect.objectContaining({
          id: "alert-c",
          alertType: "disk.predictive_failure",
          severity: "HIGH",
          source: "ZABBIX",
        }),
        ACTOR,
      );
      expect(prisma.alert.update).toHaveBeenCalledWith({
        where: { id: "alert-c" },
        data: { correlatedIncidentId: "inc-7" },
      });
      expect(result.correlatedIncidentId).toBe("inc-7");
    });

    it("leaves correlatedIncidentId null when the CI has no open incident", async () => {
      prisma.alert.findUnique.mockResolvedValue(null);
      prisma.alert.create.mockResolvedValue({ id: "alert-c", state: "OPEN" });
      incidents.findOpenByCi.mockResolvedValue(null);

      const result = await service.ingest(baseDto(), ACTOR);

      expect(incidents.linkAlert).not.toHaveBeenCalled();
      expect(result.correlatedIncidentId).toBeNull();
    });

    it("does not correlate a RECOVERED alert", async () => {
      prisma.alert.findUnique.mockResolvedValue({
        id: "alert-c",
        state: "OPEN",
        siteId: "site-1",
        ciId: "ci-1",
        correlatedIncidentId: null,
        lastSeenAt: new Date("2026-09-02T09:00:00.000Z"),
      });
      prisma.alert.update.mockResolvedValue({ id: "alert-c", state: "RECOVERED" });

      const result = await service.ingest(baseDto({ state: "RECOVERED" }), ACTOR);

      expect(incidents.findOpenByCi).not.toHaveBeenCalled();
      expect(result.correlatedIncidentId).toBeNull();
    });

    it("does not re-link an alert that is already correlated, but echoes the link", async () => {
      prisma.alert.findUnique.mockResolvedValue({
        id: "alert-c",
        state: "OPEN",
        siteId: "site-1",
        ciId: "ci-1",
        correlatedIncidentId: "inc-3",
        lastSeenAt: new Date("2026-09-02T09:00:00.000Z"),
      });
      prisma.alert.update.mockResolvedValue({ id: "alert-c", state: "OPEN" });

      const result = await service.ingest(baseDto(), ACTOR);

      expect(incidents.findOpenByCi).not.toHaveBeenCalled();
      expect(incidents.linkAlert).not.toHaveBeenCalled();
      expect(result.correlatedIncidentId).toBe("inc-3");
    });

    it("never fails ingestion when correlation throws", async () => {
      prisma.alert.findUnique.mockResolvedValue(null);
      prisma.alert.create.mockResolvedValue({ id: "alert-c", state: "OPEN" });
      incidents.findOpenByCi.mockRejectedValue(new Error("incidents service down"));

      const result = await service.ingest(baseDto(), ACTOR);

      expect(result.alertId).toBe("alert-c");
      expect(result.correlatedIncidentId).toBeNull();
    });

    it("does not correlate when the active rule disables auto-correlation", async () => {
      alertRules.getActiveRule.mockResolvedValue({
        ...DEFAULT_ALERT_RULE,
        autoCorrelateIncidents: false,
      });
      prisma.alert.findUnique.mockResolvedValue(null);
      prisma.alert.create.mockResolvedValue({ id: "alert-c", state: "OPEN" });
      incidents.findOpenByCi.mockResolvedValue({ id: "inc-7", incidentNo: "INC-000007" });

      const result = await service.ingest(baseDto(), ACTOR);

      expect(incidents.findOpenByCi).not.toHaveBeenCalled();
      expect(result.correlatedIncidentId).toBeNull();
    });
  });

  describe("alert rules drive ingest behaviour", () => {
    it("uses the rule's flapping threshold, not a constant", async () => {
      alertRules.getActiveRule.mockResolvedValue({ ...DEFAULT_ALERT_RULE, flappingThreshold: 10 });
      prisma.alert.findUnique.mockResolvedValue(null);
      prisma.alert.create.mockResolvedValue({ id: "alert-f", state: "OPEN" });
      prisma.alert.count.mockResolvedValue(5); // over the default 3, under the rule's 10

      const result = await service.ingest(baseDto(), ACTOR);

      expect(result.flapping).toBe(false);
    });

    it("uses the rule's window when counting recent occurrences", async () => {
      alertRules.getActiveRule.mockResolvedValue({
        ...DEFAULT_ALERT_RULE,
        flappingWindowMinutes: 120,
      });
      prisma.alert.findUnique.mockResolvedValue(null);
      prisma.alert.create.mockResolvedValue({ id: "alert-w", state: "OPEN" });

      const before = Date.now();
      await service.ingest(baseDto(), ACTOR);

      const since = prisma.alert.count.mock.calls[0][0].where.lastSeenAt.gte as Date;
      expect(before - since.getTime()).toBeGreaterThanOrEqual(119 * 60_000);
    });

    it("pages the NOC only for severities the rule lists", async () => {
      alertRules.getActiveRule.mockResolvedValue({
        ...DEFAULT_ALERT_RULE,
        pagingSeverities: ["HIGH"],
      });
      prisma.alert.findUnique.mockResolvedValue(null);
      prisma.alert.create.mockResolvedValue({ id: "alert-p", state: "OPEN" });
      prisma.user.findMany.mockResolvedValue([{ email: "noc@corp.example", displayName: "NOC" }]);

      await service.ingest(baseDto({ severity: "HIGH" }), ACTOR);
      expect(notifications.enqueue).toHaveBeenCalledTimes(1);

      notifications.enqueue.mockClear();
      await service.ingest(baseDto({ eventId: "evt-2", severity: "CRITICAL" }), ACTOR);
      expect(notifications.enqueue).not.toHaveBeenCalled();
    });
  });

  it("pages the NOC roster on a brand-new CRITICAL alert", async () => {
    prisma.alert.findUnique.mockResolvedValue(null);
    prisma.alert.create.mockResolvedValue({ id: "alert-crit", state: "OPEN" });
    prisma.user.findMany.mockResolvedValue([
      { email: "noc@corp.example", displayName: "NOC Desk" },
    ]);

    await service.ingest(baseDto({ severity: "CRITICAL" }), ACTOR);

    expect(notifications.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({
          kind: "ALERT_RAISED",
          alertType: "disk.predictive_failure",
        }),
        recipients: { to: [{ name: "NOC Desk", email: "noc@corp.example" }] },
      }),
      "ALERT_RAISED:alert-crit",
    );
  });

  it("does not page on a non-critical alert or on a dedup", async () => {
    prisma.alert.findUnique.mockResolvedValueOnce(null);
    prisma.alert.create.mockResolvedValue({ id: "a", state: "OPEN" });
    await service.ingest(baseDto({ severity: "HIGH" }), ACTOR);

    prisma.alert.findUnique.mockResolvedValueOnce({
      id: "a",
      state: "OPEN",
      severity: "HIGH",
      siteId: "site-1",
      ciId: "ci-1",
      lastSeenAt: new Date("2026-09-02T09:00:00.000Z"),
    });
    prisma.alert.update.mockResolvedValue({ id: "a", state: "OPEN" });
    await service.ingest(baseDto({ severity: "CRITICAL" }), ACTOR); // dedup, no state change

    expect(notifications.enqueue).not.toHaveBeenCalled();
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });

  it("throws NotFoundException for an unknown alert id", async () => {
    prisma.alert.findUnique.mockResolvedValue(null);
    await expect(service.findOne("missing")).rejects.toBeInstanceOf(NotFoundException);
  });

  describe("ingestFromZabbix", () => {
    beforeEach(() => {
      prisma.alert.findUnique.mockResolvedValue(null);
      prisma.alert.create.mockResolvedValue({ id: "alert-z", state: "OPEN" });
    });

    it("normalizes and ingests a batch, reporting per-event rejections", async () => {
      const good: ZabbixWebhookEventDto = {
        eventId: "1",
        eventValue: "1",
        name: "Disk predictive failure",
        nseverity: "4",
        timestamp: "1756808100",
        host: "SITE01-R01-SRV-038",
        tags: { site: "SITE01", ci: "SITE01-R01-SRV-038", alertType: "disk.predictive_failure" },
      };
      const bad: ZabbixWebhookEventDto = { ...good, eventId: "2", timestamp: "not-a-number" };

      const result = await service.ingestFromZabbix([good, bad], ACTOR);

      expect(result.accepted).toHaveLength(1);
      expect(result.rejected).toEqual([
        { index: 1, field: "timestamp", message: expect.any(String) },
      ]);
      expect(prisma.alert.create).toHaveBeenCalledTimes(1);
      expect(prisma.alert.create.mock.calls[0][0].data).toMatchObject({
        source: "ZABBIX",
        externalEventId: "zbx-1",
        alertType: "disk.predictive_failure",
      });
    });
  });

  describe("ingestFromAlertmanager", () => {
    beforeEach(() => {
      prisma.alert.findUnique.mockResolvedValue(null);
      prisma.alert.create.mockResolvedValue({ id: "alert-p", state: "OPEN" });
    });

    it("forwards each normalized alert and collects per-alert errors", async () => {
      const payload: AlertmanagerWebhookDto = {
        version: "4",
        status: "firing",
        alerts: [
          {
            status: "firing",
            labels: { alertname: "NodeDiskFull", site: "SITE01", ci: "SITE01-R01-SRV-038" },
            annotations: { summary: "disk full" },
            startsAt: "2025-09-02T10:15:00.000Z",
            endsAt: "0001-01-01T00:00:00Z",
            fingerprint: "abc123",
          },
          {
            status: "firing",
            labels: { alertname: "MissingSite", ci: "CI-2" },
            annotations: {},
            startsAt: "2025-09-02T10:15:00.000Z",
            endsAt: "0001-01-01T00:00:00Z",
            fingerprint: "def456",
          },
        ],
      };

      const result = await service.ingestFromAlertmanager(payload, ACTOR);

      expect(result.accepted).toHaveLength(1);
      expect(result.rejected).toEqual([{ index: 1, field: "site", message: expect.any(String) }]);
      expect(prisma.alert.create.mock.calls[0][0].data).toMatchObject({
        source: "PROMETHEUS",
        alertType: "NodeDiskFull",
      });
    });
  });

  describe("ingestFromSnmp", () => {
    beforeEach(() => {
      prisma.alert.findUnique.mockResolvedValue(null);
      prisma.alert.create.mockResolvedValue({ id: "alert-s", state: "OPEN" });
    });

    it("normalizes a batch of traps and reports per-trap rejections", async () => {
      const good = {
        ciCode: "SITE01-R03-SW-002",
        agentAddress: "10.20.3.2",
        version: "v2c",
        trapOid: "1.3.6.1.6.3.1.1.5.3",
        trapName: "linkDown",
        sysUpTimeTicks: 123456,
        varbinds: [{ oid: "1.3.6.1.2.1.31.1.1.1.1.3", name: "ifName", value: "Gi1/0/3" }],
      };
      const bad = { ciCode: "  ", agentAddress: "10.20.3.9", trapOid: "1.3.6.1.6.3.1.1.5.3" };

      const result = await service.ingestFromSnmp([good, bad], ACTOR);

      expect(result.accepted).toHaveLength(1);
      expect(result.rejected).toEqual([{ index: 1, field: "ciCode", message: expect.any(String) }]);
      expect(prisma.alert.create).toHaveBeenCalledTimes(1);
      expect(prisma.alert.create.mock.calls[0][0].data).toMatchObject({
        source: "SNMP",
        alertType: "network.link_state",
        severity: "HIGH",
      });
    });
  });
});
