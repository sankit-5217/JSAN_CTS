import { NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../common/prisma/prisma.service";
import { AlertsService } from "./alerts.service";
import { AlertmanagerWebhookDto } from "./dto/alertmanager-webhook.dto";
import { IngestAlertDto } from "./dto/ingest-alert.dto";
import { ZabbixWebhookEventDto } from "./dto/zabbix-webhook.dto";

type PrismaMock = {
  site: { findUnique: jest.Mock };
  configurationItem: { findUnique: jest.Mock };
  alert: {
    findUnique: jest.Mock;
    findMany: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    count: jest.Mock;
  };
};

function createPrismaMock(): PrismaMock {
  return {
    site: { findUnique: jest.fn() },
    configurationItem: { findUnique: jest.fn() },
    alert: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
  };
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

describe("AlertsService", () => {
  let prisma: PrismaMock;
  let service: AlertsService;

  beforeEach(() => {
    prisma = createPrismaMock();
    service = new AlertsService(prisma as unknown as PrismaService);
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

    const result = await service.ingest(baseDto());

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

    const result = await service.ingest(baseDto());

    expect(result.deduped).toBe(true);
    expect(result.stateChanged).toBe(false);
    expect(prisma.alert.create).not.toHaveBeenCalled();

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

    await service.ingest(baseDto({ occurredAt: "2026-09-02T10:15:00.000Z" }));

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

    const result = await service.ingest(baseDto({ state: "RECOVERED" }));

    expect(result.stateChanged).toBe(true);
    expect(prisma.alert.update.mock.calls[0][0].data.state).toBe("RECOVERED");
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

    const result = await service.ingest(baseDto({ state: "OPEN" }));

    expect(result.stateChanged).toBe(false);
    expect(prisma.alert.update.mock.calls[0][0].data.state).toBe("RECOVERED");
  });

  it("stores the alert unresolved when site and CI codes are unknown", async () => {
    prisma.site.findUnique.mockResolvedValue(null);
    prisma.configurationItem.findUnique.mockResolvedValue(null);
    prisma.alert.findUnique.mockResolvedValue(null);
    prisma.alert.create.mockResolvedValue({ id: "alert-2", state: "OPEN" });

    const result = await service.ingest(baseDto({ siteCode: "GHOST", ciCode: "GHOST-CI" }));

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

    const result = await service.ingest(baseDto());

    expect(result.flapping).toBe(true);
    expect(result.recentOccurrences).toBe(5);
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

      const result = await service.ingestFromZabbix([good, bad]);

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

      const result = await service.ingestFromAlertmanager(payload);

      expect(result.accepted).toHaveLength(1);
      expect(result.rejected).toEqual([{ index: 1, field: "site", message: expect.any(String) }]);
      expect(prisma.alert.create.mock.calls[0][0].data).toMatchObject({
        source: "PROMETHEUS",
        alertType: "NodeDiskFull",
      });
    });
  });
});
