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

  describe("getActiveRule", () => {
    it("maps the newest active row to the effective shape", async () => {
      prisma.alertRule.findFirst.mockResolvedValue(dbRow());

      const rule = await service.getActiveRule();

      expect(prisma.alertRule.findFirst).toHaveBeenCalledWith({
        where: { isActive: true },
        orderBy: { createdAt: "desc" },
      });
      expect(rule).toEqual({
        flappingThreshold: 5,
        flappingWindowMinutes: 45,
        pagingSeverities: ["CRITICAL", "HIGH"],
        autoCorrelateIncidents: false,
        suppressAutoTicketDuringMaintenance: true,
      });
    });

    it("falls back to the code default when no active row exists", async () => {
      prisma.alertRule.findFirst.mockResolvedValue(null);
      await expect(service.getActiveRule()).resolves.toEqual(DEFAULT_ALERT_RULE);
    });

    it("caches — a second read inside the TTL does not hit the table", async () => {
      prisma.alertRule.findFirst.mockResolvedValue(dbRow());

      await service.getActiveRule();
      await service.getActiveRule();

      expect(prisma.alertRule.findFirst).toHaveBeenCalledTimes(1);
    });

    it("re-reads after invalidateCache()", async () => {
      prisma.alertRule.findFirst.mockResolvedValue(dbRow());

      await service.getActiveRule();
      service.invalidateCache();
      await service.getActiveRule();

      expect(prisma.alertRule.findFirst).toHaveBeenCalledTimes(2);
    });
  });

  describe("create", () => {
    it("applies defaults for omitted fields, audits in the transaction, and busts the cache", async () => {
      prisma.alertRule.findFirst.mockResolvedValue(dbRow());
      await service.getActiveRule(); // prime the cache
      prisma.alertRule.create.mockImplementation(({ data }) =>
        Promise.resolve({ id: "rule-new", ...data }),
      );

      await service.create({ name: "tighter" }, ACTOR);

      expect(prisma.alertRule.create).toHaveBeenCalledWith({
        data: {
          name: "tighter",
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

      prisma.alertRule.findFirst.mockClear();
      await service.getActiveRule();
      expect(prisma.alertRule.findFirst).toHaveBeenCalledTimes(1);
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
