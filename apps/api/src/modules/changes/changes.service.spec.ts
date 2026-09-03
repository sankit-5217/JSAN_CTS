import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../common/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { ChangesService } from "./changes.service";

type PrismaMock = {
  change: {
    create: jest.Mock;
    findMany: jest.Mock;
    findUnique: jest.Mock;
    update: jest.Mock;
  };
  $transaction: jest.Mock;
};

function createPrismaMock(): PrismaMock {
  const mock: PrismaMock = {
    change: {
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

const FAR_FUTURE_START = "2099-01-01T22:00:00.000Z";
const FAR_FUTURE_END = "2099-01-01T23:00:00.000Z";

function createDto(overrides: Record<string, unknown> = {}) {
  return {
    changeType: "NORMAL" as const,
    reason: "Replace failed PSU",
    implementationPlan: "swap the unit",
    rollbackPlan: "run on PSU1",
    risk: "low",
    windowStart: FAR_FUTURE_START,
    windowEnd: FAR_FUTURE_END,
    ...overrides,
  };
}

function storedChange(overrides: Record<string, unknown> = {}) {
  return {
    id: "chg-1",
    changeType: "NORMAL",
    reason: "r",
    implementationPlan: "i",
    rollbackPlan: "b",
    risk: "low",
    windowStart: new Date(FAR_FUTURE_START),
    windowEnd: new Date(FAR_FUTURE_END),
    approverId: null,
    outcome: null,
    createdAt: new Date(),
    ...overrides,
  };
}

describe("ChangesService", () => {
  let prisma: PrismaMock;
  let audit: { record: jest.Mock };
  let service: ChangesService;

  beforeEach(() => {
    prisma = createPrismaMock();
    audit = { record: jest.fn() };
    service = new ChangesService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
    );
  });

  describe("create", () => {
    it("rejects a window that ends before it starts", async () => {
      await expect(
        service.create(createDto({ windowStart: FAR_FUTURE_END, windowEnd: FAR_FUTURE_START })),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.change.create).not.toHaveBeenCalled();
    });

    it("creates a change and returns it as PENDING_APPROVAL", async () => {
      prisma.change.create.mockResolvedValue(storedChange());
      const result = await service.create(createDto());
      expect(prisma.change.create).toHaveBeenCalled();
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ entityType: "change", action: "CHANGE_CREATED" }),
        prisma,
      );
      expect(result.status).toBe("PENDING_APPROVAL");
      expect(result.pirOverdue).toBe(false);
    });
  });

  describe("approve", () => {
    it("404s an unknown change", async () => {
      prisma.change.findUnique.mockResolvedValue(null);
      await expect(
        service.approve("missing", { approverId: "11111111-1111-1111-1111-111111111111" }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("409s a change that is already approved", async () => {
      prisma.change.findUnique.mockResolvedValue(storedChange({ approverId: "user-9" }));
      await expect(
        service.approve("chg-1", { approverId: "11111111-1111-1111-1111-111111111111" }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it("rejects approval after the window has ended", async () => {
      prisma.change.findUnique.mockResolvedValue(
        storedChange({
          windowStart: new Date("2020-01-01T00:00:00.000Z"),
          windowEnd: new Date("2020-01-01T01:00:00.000Z"),
        }),
      );
      await expect(
        service.approve("chg-1", { approverId: "11111111-1111-1111-1111-111111111111" }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("sets the approver and returns SCHEDULED for a future window", async () => {
      prisma.change.findUnique.mockResolvedValue(storedChange());
      prisma.change.update.mockResolvedValue(storedChange({ approverId: "user-7" }));
      const result = await service.approve("chg-1", {
        approverId: "11111111-1111-1111-1111-111111111111",
      });
      expect(prisma.change.update).toHaveBeenCalledWith({
        where: { id: "chg-1" },
        data: { approverId: "11111111-1111-1111-1111-111111111111" },
      });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: "CHANGE_APPROVED" }),
        prisma,
      );
      expect(result.status).toBe("SCHEDULED");
    });
  });

  describe("update", () => {
    it("409s a completed change", async () => {
      prisma.change.findUnique.mockResolvedValue(storedChange({ outcome: "done" }));
      await expect(service.update("chg-1", { risk: "high" })).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it("409s a plan edit once work is in progress", async () => {
      prisma.change.findUnique.mockResolvedValue(
        storedChange({
          approverId: "user-3",
          windowStart: new Date("2020-01-01T00:00:00.000Z"),
          windowEnd: new Date("2099-01-01T00:00:00.000Z"),
        }),
      );
      await expect(
        service.update("chg-1", { implementationPlan: "new plan" }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it("rejects an outcome recorded before the window begins", async () => {
      prisma.change.findUnique.mockResolvedValue(storedChange({ approverId: "user-3" }));
      await expect(service.update("chg-1", { outcome: "premature" })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it("accepts an outcome once the window has begun", async () => {
      prisma.change.findUnique.mockResolvedValue(
        storedChange({
          approverId: "user-3",
          windowStart: new Date("2020-01-01T00:00:00.000Z"),
          windowEnd: new Date("2020-01-01T01:00:00.000Z"),
        }),
      );
      prisma.change.update.mockResolvedValue(
        storedChange({ approverId: "user-3", outcome: "PSU replaced" }),
      );
      const result = await service.update("chg-1", { outcome: "PSU replaced" });
      expect(prisma.change.update.mock.calls[0][0].data).toEqual({ outcome: "PSU replaced" });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: "CHANGE_UPDATED" }),
        prisma,
      );
      expect(result.status).toBe("COMPLETED");
    });
  });

  describe("getActiveMaintenanceWindows", () => {
    it("queries approved, in-window, not-completed changes", async () => {
      prisma.change.findMany.mockResolvedValue([]);
      const at = new Date("2026-09-05T22:30:00.000Z");
      await service.getActiveMaintenanceWindows(at);
      const where = prisma.change.findMany.mock.calls[0][0].where;
      expect(where).toMatchObject({
        approverId: { not: null },
        windowStart: { lte: at },
        windowEnd: { gte: at },
      });
    });
  });
});
