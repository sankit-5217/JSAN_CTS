import { BadRequestException, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../common/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { BcpService } from "./bcp.service";

type PrismaMock = {
  bcpPlan: { create: jest.Mock; findMany: jest.Mock; findUnique: jest.Mock; update: jest.Mock };
  $transaction: jest.Mock;
};

function createPrismaMock(): PrismaMock {
  const mock: PrismaMock = {
    bcpPlan: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn(),
  };
  mock.$transaction.mockImplementation((fn: (tx: PrismaMock) => unknown) => fn(mock));
  return mock;
}

const ACTOR = { actorId: "user-1", correlationId: "corr-1" };
const SITE_ID = "11111111-1111-1111-1111-111111111111";

function planRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "bcp-1",
    name: "SITE01 core routing failover",
    siteId: SITE_ID,
    serviceName: null,
    recoveryStrategy: "Fail over to the B-router, then re-home links.",
    alternateSite: null,
    rtoMinutes: 240,
    rpoMinutes: 15,
    targetAvailabilityPercent: null,
    residualRisk: null,
    contacts: null,
    ownerId: null,
    lastTestedAt: null,
    nextTestDueAt: null,
    isActive: true,
    createdAt: new Date("2026-09-04T00:00:00.000Z"),
    updatedAt: new Date("2026-09-04T00:00:00.000Z"),
    ...overrides,
  };
}

function baseCreateDto(overrides: Record<string, unknown> = {}) {
  return {
    name: "SITE01 core routing failover",
    siteId: SITE_ID,
    recoveryStrategy: "Fail over to the B-router, then re-home links.",
    rtoMinutes: 240,
    rpoMinutes: 15,
    ...overrides,
  } as Parameters<BcpService["create"]>[0];
}

describe("BcpService", () => {
  let prisma: PrismaMock;
  let audit: { record: jest.Mock };
  let service: BcpService;

  beforeEach(() => {
    prisma = createPrismaMock();
    audit = { record: jest.fn() };
    service = new BcpService(prisma as unknown as PrismaService, audit as unknown as AuditService);
  });

  describe("create", () => {
    it("stores the plan and audits it in the transaction", async () => {
      prisma.bcpPlan.create.mockImplementation(({ data }) =>
        Promise.resolve({ ...planRow(), ...data }),
      );

      const result = await service.create(baseCreateDto(), ACTOR);

      expect(prisma.bcpPlan.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ siteId: SITE_ID, serviceName: null, rtoMinutes: 240 }),
      });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ entityType: "bcp_plan", action: "BCP_PLAN_CREATED" }),
        prisma,
      );
      expect(result.readiness).toBe("UNTESTED");
    });

    it("rejects a plan with both a site and a service", async () => {
      await expect(
        service.create(baseCreateDto({ serviceName: "Core routing" }), ACTOR),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.bcpPlan.create).not.toHaveBeenCalled();
    });

    it("rejects a plan with neither a site nor a service", async () => {
      await expect(
        service.create(baseCreateDto({ siteId: undefined }), ACTOR),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe("list", () => {
    it("view=due filters to plans tested before whose next test date has passed", async () => {
      prisma.bcpPlan.findMany.mockResolvedValue([]);

      await service.list({ view: "due" });

      const where = prisma.bcpPlan.findMany.mock.calls[0][0].where;
      expect(where.AND).toContainEqual({
        lastTestedAt: { not: null },
        nextTestDueAt: { lt: expect.any(Date) },
      });
    });

    it("decorates each row with readiness", async () => {
      prisma.bcpPlan.findMany.mockResolvedValue([
        planRow({
          lastTestedAt: new Date("2026-01-01T00:00:00.000Z"),
          nextTestDueAt: new Date("2026-06-01T00:00:00.000Z"),
        }),
      ]);

      const [row] = await service.list({});

      expect(row.readiness).toBe("DUE");
      expect(row.testOverdue).toBe(true);
    });
  });

  describe("getOne", () => {
    it("404s an unknown plan", async () => {
      prisma.bcpPlan.findUnique.mockResolvedValue(null);
      await expect(service.getOne("missing")).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("update", () => {
    it("applies field edits and audits before/after", async () => {
      prisma.bcpPlan.findUnique.mockResolvedValue(planRow());
      prisma.bcpPlan.update.mockImplementation(({ data }) =>
        Promise.resolve({ ...planRow(), ...data }),
      );

      await service.update("bcp-1", { rtoMinutes: 120, isActive: false }, ACTOR);

      expect(prisma.bcpPlan.update).toHaveBeenCalledWith({
        where: { id: "bcp-1" },
        data: { rtoMinutes: 120, isActive: false },
      });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ entityType: "bcp_plan", action: "BCP_PLAN_UPDATED" }),
        prisma,
      );
    });

    it("404s an unknown plan", async () => {
      prisma.bcpPlan.findUnique.mockResolvedValue(null);
      await expect(service.update("missing", { name: "x" }, ACTOR)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe("recordTest", () => {
    it("stamps lastTestedAt, sets the next due date, and audits BCP_PLAN_TESTED", async () => {
      prisma.bcpPlan.findUnique.mockResolvedValue(planRow());
      prisma.bcpPlan.update.mockImplementation(({ data }) =>
        Promise.resolve({ ...planRow(), ...data }),
      );

      await service.recordTest(
        "bcp-1",
        { nextTestDueAt: "2027-03-01T00:00:00.000Z", notes: "Clean failover in 3m12s" },
        ACTOR,
      );

      const data = prisma.bcpPlan.update.mock.calls[0][0].data;
      expect(data.lastTestedAt).toBeInstanceOf(Date);
      expect(data.nextTestDueAt).toEqual(new Date("2027-03-01T00:00:00.000Z"));
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: "BCP_PLAN_TESTED" }),
        prisma,
      );
    });

    it("404s an unknown plan", async () => {
      prisma.bcpPlan.findUnique.mockResolvedValue(null);
      await expect(service.recordTest("missing", {}, ACTOR)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
