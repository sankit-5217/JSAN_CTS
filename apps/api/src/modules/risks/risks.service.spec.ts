import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../common/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { RisksService } from "./risks.service";

type PrismaMock = {
  risk: {
    create: jest.Mock;
    findMany: jest.Mock;
    findUnique: jest.Mock;
    update: jest.Mock;
  };
  $transaction: jest.Mock;
};

function createPrismaMock(): PrismaMock {
  const mock: PrismaMock = {
    risk: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn(),
  };
  // The callback gets the mock itself standing in as the transaction client.
  mock.$transaction.mockImplementation((fn: (tx: PrismaMock) => unknown) => fn(mock));
  return mock;
}

function storedRisk(overrides: Record<string, unknown> = {}) {
  return {
    id: "risk-1",
    siteId: null,
    description: "single upstream power feed to Row 4",
    likelihood: 3,
    impact: 4,
    score: 12,
    mitigation: null as string | null,
    ownerId: null,
    dueDate: null as Date | null,
    status: "OPEN",
    createdAt: new Date(),
    ...overrides,
  };
}

describe("RisksService", () => {
  let prisma: PrismaMock;
  let audit: { record: jest.Mock };
  let service: RisksService;

  beforeEach(() => {
    prisma = createPrismaMock();
    audit = { record: jest.fn() };
    service = new RisksService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
    );
  });

  describe("create", () => {
    it("computes score server-side and audits the registration in-transaction", async () => {
      prisma.risk.create.mockResolvedValue(storedRisk({ score: 12 }));
      const result = await service.create({ description: "d", likelihood: 3, impact: 4 });

      expect(prisma.risk.create.mock.calls[0][0].data.score).toBe(12);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ entityType: "risk", action: "RISK_REGISTERED" }),
        prisma,
      );
      expect(result.severity).toBe("HIGH");
      expect(result.overdue).toBe(false);
    });
  });

  describe("list", () => {
    it("translates a severity filter into a score range", async () => {
      prisma.risk.findMany.mockResolvedValue([]);
      await service.list({ severity: "CRITICAL" });
      const where = prisma.risk.findMany.mock.calls[0][0].where;
      expect(where.AND).toContainEqual({ score: { gte: 15, lte: 25 } });
    });

    it("overdue view excludes CLOSED and filters on due date", async () => {
      prisma.risk.findMany.mockResolvedValue([]);
      await service.list({ view: "overdue" });
      const where = prisma.risk.findMany.mock.calls[0][0].where;
      expect(where.AND).toContainEqual({ status: { not: "CLOSED" } });
      expect(
        where.AND.some((c: { dueDate?: { lt?: unknown } }) => c.dueDate?.lt instanceof Date),
      ).toBe(true);
    });

    it("overdue view keeps an explicit status filter instead of not-CLOSED", async () => {
      prisma.risk.findMany.mockResolvedValue([]);
      await service.list({ view: "overdue", status: "OPEN" });
      const where = prisma.risk.findMany.mock.calls[0][0].where;
      expect(where.AND).toContainEqual({ status: "OPEN" });
      expect(where.AND).not.toContainEqual({ status: { not: "CLOSED" } });
    });

    it("orders by score desc then soonest due date", async () => {
      prisma.risk.findMany.mockResolvedValue([]);
      await service.list({});
      const args = prisma.risk.findMany.mock.calls[0][0];
      expect(args.orderBy).toEqual([{ score: "desc" }, { dueDate: "asc" }]);
      expect(args.where).toEqual({});
    });
  });

  describe("getOne", () => {
    it("404s an unknown risk", async () => {
      prisma.risk.findUnique.mockResolvedValue(null);
      await expect(service.getOne("missing")).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("update", () => {
    it("re-computes score when likelihood changes and audits before/after", async () => {
      prisma.risk.findUnique.mockResolvedValue(storedRisk({ likelihood: 3, impact: 4, score: 12 }));
      prisma.risk.update.mockResolvedValue(storedRisk({ likelihood: 5, score: 20 }));
      await service.update("risk-1", { likelihood: 5 });

      expect(prisma.risk.update.mock.calls[0][0].data.score).toBe(20);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: "RISK_UPDATED" }),
        prisma,
      );
    });

    it("leaves score alone for a description-only edit", async () => {
      prisma.risk.findUnique.mockResolvedValue(storedRisk());
      prisma.risk.update.mockResolvedValue(storedRisk());
      await service.update("risk-1", { description: "clearer wording of the exposure" });
      expect(prisma.risk.update.mock.calls[0][0].data.score).toBeUndefined();
    });
  });

  describe("changeStatus", () => {
    it("409s an illegal transition", async () => {
      prisma.risk.findUnique.mockResolvedValue(storedRisk({ status: "CLOSED" }));
      await expect(service.changeStatus("risk-1", { status: "ACCEPTED" })).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it("400s a move to ACCEPTED with no mitigation on record or in the request", async () => {
      prisma.risk.findUnique.mockResolvedValue(storedRisk({ status: "OPEN", mitigation: null }));
      await expect(service.changeStatus("risk-1", { status: "ACCEPTED" })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it("accepts the move when mitigation is supplied in the same call", async () => {
      prisma.risk.findUnique.mockResolvedValue(storedRisk({ status: "OPEN", mitigation: null }));
      prisma.risk.update.mockResolvedValue(
        storedRisk({ status: "ACCEPTED", mitigation: "residual owned by infra lead" }),
      );
      const result = await service.changeStatus("risk-1", {
        status: "ACCEPTED",
        mitigation: "residual owned by infra lead",
      });

      expect(prisma.risk.update.mock.calls[0][0].data).toEqual({
        status: "ACCEPTED",
        mitigation: "residual owned by infra lead",
      });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "RISK_STATUS_CHANGED",
          before: { status: "OPEN", mitigation: null },
          after: { status: "ACCEPTED", mitigation: "residual owned by infra lead" },
        }),
        prisma,
      );
      expect(result.status).toBe("ACCEPTED");
    });

    it("allows CLOSE without mitigation", async () => {
      prisma.risk.findUnique.mockResolvedValue(storedRisk({ status: "OPEN", mitigation: null }));
      prisma.risk.update.mockResolvedValue(storedRisk({ status: "CLOSED" }));
      const result = await service.changeStatus("risk-1", { status: "CLOSED" });
      expect(result.status).toBe("CLOSED");
    });

    it("reuses mitigation already on the record when moving to MITIGATING", async () => {
      prisma.risk.findUnique.mockResolvedValue(
        storedRisk({ status: "OPEN", mitigation: "install the B feed" }),
      );
      prisma.risk.update.mockResolvedValue(
        storedRisk({ status: "MITIGATING", mitigation: "install the B feed" }),
      );
      const result = await service.changeStatus("risk-1", { status: "MITIGATING" });
      expect(result.status).toBe("MITIGATING");
      expect(prisma.risk.update.mock.calls[0][0].data).toEqual({ status: "MITIGATING" });
    });
  });
});
