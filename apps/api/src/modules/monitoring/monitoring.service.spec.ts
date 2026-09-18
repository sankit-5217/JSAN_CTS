import { NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../common/prisma/prisma.service";
import { AlertsService } from "../alerts/alerts.service";
import { AuditService } from "../audit/audit.service";
import type { HealthSnapshotDto } from "./dto/health-snapshot.dto";
import { MonitoringService } from "./monitoring.service";

type PrismaMock = {
  configurationItem: { findUnique: jest.Mock };
  healthSnapshot: { upsert: jest.Mock; findUnique: jest.Mock };
  site: { findUnique: jest.Mock };
  alert: { findUnique: jest.Mock };
  $transaction: jest.Mock;
};

function createPrismaMock(): PrismaMock {
  const mock: PrismaMock = {
    configurationItem: { findUnique: jest.fn() },
    healthSnapshot: { upsert: jest.fn(), findUnique: jest.fn() },
    site: { findUnique: jest.fn().mockResolvedValue({ code: "SITE01" }) },
    alert: { findUnique: jest.fn() },
    $transaction: jest.fn(),
  };
  mock.$transaction.mockImplementation((fn: (tx: PrismaMock) => unknown) => fn(mock));
  return mock;
}

const ACTOR = { actorId: "collector-svc", correlationId: "corr-1" };
const CI = { id: "ci-1", ciCode: "SITE01-R01-SRV-040", siteId: "site-1" };

function snapshot(overrides: Partial<HealthSnapshotDto> = {}): HealthSnapshotDto {
  return {
    ciCode: "SITE01-R01-SRV-040",
    source: "REDFISH",
    overallHealth: "WARNING",
    powerState: "ON",
    observedAt: "2026-09-03T10:15:00.000Z",
    degraded: [{ kind: "DRIVE", name: "Disk 1", health: "WARNING" }],
    predictiveFailures: [{ kind: "DRIVE", name: "Disk 1", detail: "SMART" }],
    summary: {
      drives: { total: 2, healthy: 1, predictedFailure: 1 },
      fans: { total: 4, healthy: 4 },
    },
    ...overrides,
  } as HealthSnapshotDto;
}

describe("MonitoringService", () => {
  let prisma: PrismaMock;
  let audit: { record: jest.Mock };
  let alerts: { ingest: jest.Mock };
  let service: MonitoringService;

  beforeEach(() => {
    prisma = createPrismaMock();
    audit = { record: jest.fn() };
    alerts = { ingest: jest.fn().mockResolvedValue({}) };
    service = new MonitoringService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
      alerts as unknown as AlertsService,
    );
  });

  describe("recordSnapshots", () => {
    it("upserts on ci_id with the payload as details and audits in-transaction", async () => {
      prisma.configurationItem.findUnique.mockResolvedValue(CI);
      prisma.healthSnapshot.upsert.mockResolvedValue({ id: "hs-1", overallHealth: "WARNING" });

      const result = await service.recordSnapshots([snapshot()], ACTOR);

      const args = prisma.healthSnapshot.upsert.mock.calls[0][0];
      expect(args.where).toEqual({ ciId: "ci-1" });
      expect(args.create.overallHealth).toBe("WARNING");
      expect(args.create.lastHeartbeatAt).toEqual(new Date("2026-09-03T10:15:00.000Z"));
      expect(args.create.details).toMatchObject({ source: "REDFISH", powerState: "ON" });
      expect(args.create.details).not.toHaveProperty("ciCode");
      expect(args.create.details).not.toHaveProperty("observedAt");

      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: "health_snapshot",
          action: "HEALTH_SNAPSHOT_RECORDED",
          after: expect.objectContaining({ ciCode: "SITE01-R01-SRV-040", degradedCount: 1 }),
        }),
        prisma,
      );
      expect(result.accepted).toEqual([
        { ciCode: "SITE01-R01-SRV-040", ciId: "ci-1", overallHealth: "WARNING", degradedCount: 1 },
      ]);
      expect(result.rejected).toEqual([]);
    });

    it("rejects an unknown CI per-item without dropping the batch", async () => {
      prisma.configurationItem.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: "ci-2", ciCode: "SITE01-R01-SRV-041", siteId: "site-1" });
      prisma.healthSnapshot.upsert.mockResolvedValue({ id: "hs-2", overallHealth: "HEALTHY" });

      const result = await service.recordSnapshots(
        [
          snapshot({ ciCode: "GHOST" }),
          snapshot({ ciCode: "SITE01-R01-SRV-041", overallHealth: "HEALTHY", degraded: [] }),
        ],
        ACTOR,
      );

      expect(result.rejected).toEqual([{ index: 0, ciCode: "GHOST", reason: "unknown CI" }]);
      expect(result.accepted).toHaveLength(1);
      expect(prisma.healthSnapshot.upsert).toHaveBeenCalledTimes(1);
    });
  });

  describe("recordSnapshots — hardware-health alert sync", () => {
    beforeEach(() => {
      prisma.configurationItem.findUnique.mockResolvedValue(CI);
      prisma.healthSnapshot.upsert.mockImplementation(
        (args: { create: Record<string, unknown> }) => ({
          id: "hs-1",
          overallHealth: args.create.overallHealth,
        }),
      );
    });

    it("raises a hardware.health_degraded alert with a fresh eventId on first bad reading", async () => {
      prisma.healthSnapshot.findUnique.mockResolvedValue(null);

      await service.recordSnapshots([snapshot({ overallHealth: "CRITICAL" })], ACTOR);

      expect(alerts.ingest).toHaveBeenCalledTimes(1);
      const [payload] = alerts.ingest.mock.calls[0];
      expect(payload).toMatchObject({
        source: "REDFISH",
        siteCode: "SITE01",
        ciCode: "SITE01-R01-SRV-040",
        alertType: "hardware.health_degraded",
        severity: "CRITICAL",
        state: "OPEN",
      });
      expect(typeof payload.eventId).toBe("string");
      expect(payload.eventId.length).toBeGreaterThan(0);

      const upsertArgs = prisma.healthSnapshot.upsert.mock.calls[0][0];
      expect(upsertArgs.create.openAlertEventId).toBe(payload.eventId);
    });

    it("reuses the same eventId on a repeated bad reading instead of opening a new alert", async () => {
      prisma.healthSnapshot.findUnique.mockResolvedValue({ openAlertEventId: "episode-1" });

      await service.recordSnapshots([snapshot({ overallHealth: "WARNING" })], ACTOR);

      expect(alerts.ingest).toHaveBeenCalledTimes(1);
      const [payload] = alerts.ingest.mock.calls[0];
      expect(payload.eventId).toBe("episode-1");
      expect(payload.state).toBe("OPEN");

      const upsertArgs = prisma.healthSnapshot.upsert.mock.calls[0][0];
      expect(upsertArgs.create.openAlertEventId).toBe("episode-1");
    });

    it("recovers the alert under the same eventId, keeping its last severity, when health returns to HEALTHY", async () => {
      prisma.healthSnapshot.findUnique.mockResolvedValue({ openAlertEventId: "episode-1" });
      prisma.alert.findUnique.mockResolvedValue({ severity: "CRITICAL" });

      await service.recordSnapshots(
        [snapshot({ overallHealth: "HEALTHY", degraded: [] })],
        ACTOR,
      );

      expect(alerts.ingest).toHaveBeenCalledTimes(1);
      const [payload] = alerts.ingest.mock.calls[0];
      expect(payload).toMatchObject({
        eventId: "episode-1",
        state: "RECOVERED",
        severity: "CRITICAL",
      });

      const upsertArgs = prisma.healthSnapshot.upsert.mock.calls[0][0];
      expect(upsertArgs.create.openAlertEventId).toBeNull();
    });

    it("does not touch alerts for an UNKNOWN reading with no open episode", async () => {
      prisma.healthSnapshot.findUnique.mockResolvedValue(null);

      await service.recordSnapshots(
        [snapshot({ overallHealth: "UNKNOWN", degraded: [] })],
        ACTOR,
      );

      expect(alerts.ingest).not.toHaveBeenCalled();
      const upsertArgs = prisma.healthSnapshot.upsert.mock.calls[0][0];
      expect(upsertArgs.create.openAlertEventId).toBeNull();
    });

    it("carries an open episode forward through an UNKNOWN reading without recovering it", async () => {
      prisma.healthSnapshot.findUnique.mockResolvedValue({ openAlertEventId: "episode-1" });

      await service.recordSnapshots(
        [snapshot({ overallHealth: "UNKNOWN", degraded: [] })],
        ACTOR,
      );

      expect(alerts.ingest).not.toHaveBeenCalled();
      const upsertArgs = prisma.healthSnapshot.upsert.mock.calls[0][0];
      expect(upsertArgs.create.openAlertEventId).toBe("episode-1");
    });

    it("never fails the snapshot write when the alert sync throws", async () => {
      prisma.healthSnapshot.findUnique.mockResolvedValue(null);
      alerts.ingest.mockRejectedValue(new Error("alerts service unavailable"));

      const result = await service.recordSnapshots(
        [snapshot({ overallHealth: "CRITICAL" })],
        ACTOR,
      );

      expect(result.accepted).toHaveLength(1);
      expect(result.rejected).toEqual([]);
    });
  });

  describe("recordHeartbeat", () => {
    it("writes an append-only COLLECTOR_HEARTBEAT audit event for the site", async () => {
      const result = await service.recordHeartbeat("SITE01", ACTOR);

      expect(result.recordedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: "collector",
          entityId: "SITE01",
          action: "COLLECTOR_HEARTBEAT",
          actorId: "collector-svc",
        }),
      );
    });
  });

  describe("getForCi", () => {
    it("404s an unknown CI", async () => {
      prisma.configurationItem.findUnique.mockResolvedValue(null);
      await expect(service.getForCi("GHOST")).rejects.toBeInstanceOf(NotFoundException);
    });

    it("404s a CI with no snapshot yet", async () => {
      prisma.configurationItem.findUnique.mockResolvedValue({ id: "ci-1" });
      prisma.healthSnapshot.findUnique.mockResolvedValue(null);
      await expect(service.getForCi("SITE01-R01-SRV-040")).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it("returns the stored snapshot", async () => {
      prisma.configurationItem.findUnique.mockResolvedValue({ id: "ci-1" });
      prisma.healthSnapshot.findUnique.mockResolvedValue({ id: "hs-1", overallHealth: "CRITICAL" });
      await expect(service.getForCi("SITE01-R01-SRV-040")).resolves.toMatchObject({
        overallHealth: "CRITICAL",
      });
    });
  });
});
