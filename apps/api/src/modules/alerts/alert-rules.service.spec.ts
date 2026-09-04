import { NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../common/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { AlertRulesService } from "./alert-rules.service";
import { DEFAULT_ALERT_RULE } from "./alerts.constants";

type PrismaMock = {
  alertRule: {
    findFirst: jest.Mock;
    findUnique: jest.Mock;
    findMany: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
  $transaction: jest.Mock;
};

function createPrismaMock(): PrismaMock {
  const mock: PrismaMock = {
    alertRule: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn(),
  };
  mock.$transaction.mockImplementation((fn: (tx: PrismaMock) => unknown) => fn(mock));
  return mock;
}

const ACTOR = { actorId: "user-1", correlationId: "corr-1" };

function dbRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "rule-1",
    name: "default",
    siteId: null,
    alertType: null,
    flappingThreshold: 5,
    flappingWindowMinutes: 45,
    pagingSeverities: ["CRITICAL", "HIGH"],
    autoCorrelateIncidents: false,
    suppressAutoTicketDuringMaintenance: true,
    isActive: true,
    createdAt: new Date("2026-09-04T00:00:00.000Z"),
    updatedAt: new Date("2026-09-04T00:00:00.000Z"),
    ...overrides,
  };
}

const EFFECTIVE_FROM_DBROW = {
  flappingThreshold: 5,
  flappingWindowMinutes: 45,
  pagingSeverities: ["CRITICAL", "HIGH"],
  autoCorrelateIncidents: false,
  suppressAutoTicketDuringMaintenance: true,
};

describe("AlertRulesService", () => {
  let prisma: PrismaMock;
  let audit: { record: jest.Mock };
  let service: AlertRulesService;

  beforeEach(() => {
    prisma = createPrismaMock();
    audit = { record: jest.fn() };
    service = new AlertRulesService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
    );
  });

  describe("resolveRule", () => {
    it("maps the matching active row to the effective shape", async () => {
      prisma.alertRule.findMany.mockResolvedValue([dbRow()]);

      const rule = await service.resolveRule({ siteId: "site-1", alertType: "disk.fail" });

      expect(prisma.alertRule.findMany).toHaveBeenCalledWith({
        where: { isActive: true },
        orderBy: { createdAt: "desc" },
      });
      expect(rule).toEqual(EFFECTIVE_FROM_DBROW);
    });

    it("falls back to the code default when no rule matches", async () => {
      prisma.alertRule.findMany.mockResolvedValue([]);
      await expect(service.resolveRule()).resolves.toEqual(DEFAULT_ALERT_RULE);
    });

    it("picks the most specific match: site+type > site > type > global", async () => {
      prisma.alertRule.findMany.mockResolvedValue([
        dbRow({ id: "global", name: "global", flappingThreshold: 1 }),
        dbRow({ id: "type", name: "type", alertType: "disk.fail", flappingThreshold: 2 }),
        dbRow({ id: "site", name: "site", siteId: "site-1", flappingThreshold: 3 }),
        dbRow({
          id: "site+type",
          name: "site+type",
          siteId: "site-1",
          alertType: "disk.fail",
          flappingThreshold: 4,
        }),
      ]);

      const hit = await service.resolveRule({ siteId: "site-1", alertType: "disk.fail" });
      expect(hit.flappingThreshold).toBe(4);

      service.invalidateCache();
      const siteOnly = await service.resolveRule({ siteId: "site-1", alertType: "cpu.hot" });
      expect(siteOnly.flappingThreshold).toBe(3);

      service.invalidateCache();
      const typeOnly = await service.resolveRule({ siteId: "site-9", alertType: "disk.fail" });
      expect(typeOnly.flappingThreshold).toBe(2);

      service.invalidateCache();
      const global = await service.resolveRule({ siteId: "site-9", alertType: "cpu.hot" });
      expect(global.flappingThreshold).toBe(1);
    });

    it("caches — a second resolve inside the TTL does not hit the table", async () => {
      prisma.alertRule.findMany.mockResolvedValue([dbRow()]);

      await service.resolveRule();
      await service.resolveRule({ siteId: "site-2" });

      expect(prisma.alertRule.findMany).toHaveBeenCalledTimes(1);
    });

    it("re-reads after invalidateCache()", async () => {
      prisma.alertRule.findMany.mockResolvedValue([dbRow()]);

      await service.resolveRule();
      service.invalidateCache();
      await service.resolveRule();

      expect(prisma.alertRule.findMany).toHaveBeenCalledTimes(2);
    });
  });

  describe("create", () => {
    it("applies defaults for omitted fields, audits in the transaction, and busts the cache", async () => {
      prisma.alertRule.findMany.mockResolvedValue([dbRow()]);
      await service.resolveRule(); // prime the cache
      prisma.alertRule.create.mockImplementation(({ data }) =>
        Promise.resolve({ id: "rule-new", ...data }),
      );

      await service.create({ name: "tighter" }, ACTOR);

      expect(prisma.alertRule.create).toHaveBeenCalledWith({
        data: {
          name: "tighter",
          siteId: null,
          alertType: null,
          flappingThreshold: DEFAULT_ALERT_RULE.flappingThreshold,
          flappingWindowMinutes: DEFAULT_ALERT_RULE.flappingWindowMinutes,
          pagingSeverities: DEFAULT_ALERT_RULE.pagingSeverities,
          autoCorrelateIncidents: DEFAULT_ALERT_RULE.autoCorrelateIncidents,
          suppressAutoTicketDuringMaintenance:
            DEFAULT_ALERT_RULE.suppressAutoTicketDuringMaintenance,
          isActive: true,
        },
      });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ entityType: "AlertRule", action: "CREATE" }),
        prisma,
      );

      prisma.alertRule.findMany.mockClear();
      await service.resolveRule();
      expect(prisma.alertRule.findMany).toHaveBeenCalledTimes(1);
    });

    it("persists a site+type scope", async () => {
      prisma.alertRule.create.mockImplementation(({ data }) =>
        Promise.resolve({ id: "scoped", ...data }),
      );

      await service.create(
        { name: "noisy-lab", siteId: "site-lab", alertType: "disk.fail" },
        ACTOR,
      );

      expect(prisma.alertRule.create.mock.calls[0][0].data).toMatchObject({
        siteId: "site-lab",
        alertType: "disk.fail",
      });
    });
  });

  describe("update", () => {
    it("audits before/after in the transaction and busts the cache", async () => {
      prisma.alertRule.findUnique.mockResolvedValue(dbRow());
      prisma.alertRule.update.mockImplementation(({ data }) =>
        Promise.resolve({ ...dbRow(), ...data }),
      );

      await service.update("rule-1", { flappingThreshold: 9 }, ACTOR);

      expect(prisma.alertRule.update).toHaveBeenCalledWith({
        where: { id: "rule-1" },
        data: expect.objectContaining({ flappingThreshold: 9 }),
      });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ entityType: "AlertRule", action: "UPDATE" }),
        prisma,
      );
    });

    it("404s an unknown rule", async () => {
      prisma.alertRule.findUnique.mockResolvedValue(null);
      await expect(service.update("missing", { name: "x" }, ACTOR)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
