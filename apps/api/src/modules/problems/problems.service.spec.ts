import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../common/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { ChangesService } from "../changes/changes.service";
import { IncidentsService } from "../incidents/incidents.service";
import { ProblemsService } from "./problems.service";

type PrismaMock = {
  problem: { create: jest.Mock; findMany: jest.Mock; findUnique: jest.Mock; update: jest.Mock };
  problemActionItem: { create: jest.Mock; findUnique: jest.Mock; update: jest.Mock };
  problemLink: { findUnique: jest.Mock; create: jest.Mock; delete: jest.Mock };
  $transaction: jest.Mock;
  $queryRaw: jest.Mock;
};

function createPrismaMock(): PrismaMock {
  const mock: PrismaMock = {
    problem: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    problemActionItem: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    problemLink: { findUnique: jest.fn(), create: jest.fn(), delete: jest.fn() },
    $transaction: jest.fn(),
    $queryRaw: jest.fn().mockResolvedValue([{ nextval: BigInt(7) }]),
  };
  mock.$transaction.mockImplementation((fn: (tx: PrismaMock) => unknown) => fn(mock));
  return mock;
}

const ACTOR = { actorId: "user-1", correlationId: "corr-1" };

function baseProblem(overrides: Record<string, unknown> = {}) {
  return {
    id: "prob-1",
    problemNo: "PRB-000007",
    title: "Recurring PSU trips on rack 4",
    status: "OPEN",
    priority: null,
    symptoms: "Random power loss",
    knownError: null,
    rootCause: null,
    correctiveAction: null,
    preventiveAction: null,
    ownerUserId: null,
    dueDate: null,
    resolvedAt: null,
    closedAt: null,
    createdAt: new Date("2026-09-04T00:00:00.000Z"),
    updatedAt: new Date("2026-09-04T00:00:00.000Z"),
    ...overrides,
  };
}

describe("ProblemsService", () => {
  let prisma: PrismaMock;
  let audit: { record: jest.Mock };
  let incidents: { findOne: jest.Mock };
  let changes: { getOne: jest.Mock };
  let service: ProblemsService;

  beforeEach(() => {
    prisma = createPrismaMock();
    audit = { record: jest.fn() };
    incidents = { findOne: jest.fn().mockResolvedValue({ id: "inc-1" }) };
    changes = { getOne: jest.fn().mockResolvedValue({ id: "chg-1" }) };
    service = new ProblemsService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
      incidents as unknown as IncidentsService,
      changes as unknown as ChangesService,
    );
  });

  describe("create", () => {
    it("numbers from the sequence and audits inside the transaction", async () => {
      prisma.problem.create.mockImplementation(({ data }) =>
        Promise.resolve({ ...baseProblem(), ...data }),
      );

      const result = await service.create(
        { title: "Recurring PSU trips on rack 4", symptoms: "Random power loss" },
        ACTOR,
      );

      expect(result.problemNo).toBe("PRB-000007");
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ entityType: "problem", action: "PROBLEM_CREATED" }),
        prisma,
      );
    });
  });

  describe("transition", () => {
    it("applies a valid move and audits it", async () => {
      prisma.problem.findUnique.mockResolvedValue(baseProblem({ status: "OPEN" }));
      prisma.problem.update.mockImplementation(({ data }) =>
        Promise.resolve({ ...baseProblem(), ...data }),
      );

      await service.transition("prob-1", { toStatus: "INVESTIGATING" }, ACTOR);

      expect(prisma.problem.update).toHaveBeenCalledWith({
        where: { id: "prob-1" },
        data: expect.objectContaining({ status: "INVESTIGATING" }),
      });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: "PROBLEM_STATUS_CHANGED" }),
        prisma,
      );
    });

    it("rejects a move that skips investigation", async () => {
      prisma.problem.findUnique.mockResolvedValue(baseProblem({ status: "OPEN" }));
      await expect(
        service.transition("prob-1", { toStatus: "RESOLVED" }, ACTOR),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.problem.update).not.toHaveBeenCalled();
    });

    it("rejects a no-op transition", async () => {
      prisma.problem.findUnique.mockResolvedValue(baseProblem({ status: "INVESTIGATING" }));
      await expect(
        service.transition("prob-1", { toStatus: "INVESTIGATING" }, ACTOR),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("requires a root cause before RESOLVED", async () => {
      prisma.problem.findUnique.mockResolvedValue(
        baseProblem({ status: "INVESTIGATING", rootCause: null }),
      );
      await expect(
        service.transition("prob-1", { toStatus: "RESOLVED" }, ACTOR),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("stamps resolvedAt when a root cause is present", async () => {
      prisma.problem.findUnique.mockResolvedValue(
        baseProblem({ status: "INVESTIGATING", rootCause: "Failed PDU breaker" }),
      );
      prisma.problem.update.mockImplementation(({ data }) =>
        Promise.resolve({ ...baseProblem(), ...data }),
      );

      await service.transition("prob-1", { toStatus: "RESOLVED" }, ACTOR);

      expect(prisma.problem.update.mock.calls[0][0].data.resolvedAt).toBeInstanceOf(Date);
    });
  });

  describe("action items", () => {
    it("adds an item and audits it", async () => {
      prisma.problem.findUnique.mockResolvedValue(baseProblem());
      prisma.problemActionItem.create.mockImplementation(({ data }) =>
        Promise.resolve({ id: "ai-1", ...data }),
      );

      await service.addActionItem("prob-1", { description: "Replace the PDU" }, ACTOR);

      expect(prisma.problemActionItem.create).toHaveBeenCalledWith({
        data: { problemId: "prob-1", description: "Replace the PDU", assigneeUserId: null, dueDate: null },
      });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: "PROBLEM_ACTION_ITEM_ADDED" }),
        prisma,
      );
    });

    it("404s adding an item to an unknown problem", async () => {
      prisma.problem.findUnique.mockResolvedValue(null);
      await expect(
        service.addActionItem("missing", { description: "x" }, ACTOR),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("completing is idempotent once done", async () => {
      prisma.problemActionItem.findUnique.mockResolvedValue({
        id: "ai-1",
        problemId: "prob-1",
        completedAt: new Date("2026-09-04T10:00:00.000Z"),
      });

      await service.completeActionItem("prob-1", "ai-1", ACTOR);

      expect(prisma.problemActionItem.update).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it("404s when the item does not belong to the problem", async () => {
      prisma.problemActionItem.findUnique.mockResolvedValue({ id: "ai-1", problemId: "other" });
      await expect(
        service.completeActionItem("prob-1", "ai-1", ACTOR),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("links", () => {
    it("validates the incident through IncidentsService before linking", async () => {
      prisma.problem.findUnique.mockResolvedValue(baseProblem());
      prisma.problemLink.findUnique.mockResolvedValue(null);
      prisma.problemLink.create.mockImplementation(({ data }) =>
        Promise.resolve({ id: "lnk-1", ...data }),
      );

      await service.link("prob-1", { entityType: "INCIDENT", entityId: "inc-1" }, ACTOR);

      expect(incidents.findOne).toHaveBeenCalledWith("inc-1");
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: "PROBLEM_LINKED" }),
        prisma,
      );
    });

    it("validates a change through ChangesService", async () => {
      prisma.problem.findUnique.mockResolvedValue(baseProblem());
      prisma.problemLink.findUnique.mockResolvedValue(null);
      prisma.problemLink.create.mockImplementation(({ data }) =>
        Promise.resolve({ id: "lnk-2", ...data }),
      );

      await service.link("prob-1", { entityType: "CHANGE", entityId: "chg-1" }, ACTOR);

      expect(changes.getOne).toHaveBeenCalledWith("chg-1");
    });

    it("propagates a 404 for an unknown incident", async () => {
      prisma.problem.findUnique.mockResolvedValue(baseProblem());
      incidents.findOne.mockRejectedValue(new NotFoundException("Incident inc-x not found"));

      await expect(
        service.link("prob-1", { entityType: "INCIDENT", entityId: "inc-x" }, ACTOR),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.problemLink.create).not.toHaveBeenCalled();
    });

    it("409s a duplicate link", async () => {
      prisma.problem.findUnique.mockResolvedValue(baseProblem());
      prisma.problemLink.findUnique.mockResolvedValue({ id: "lnk-1" });

      await expect(
        service.link("prob-1", { entityType: "INCIDENT", entityId: "inc-1" }, ACTOR),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it("unlink 404s when the link is on another problem", async () => {
      prisma.problemLink.findUnique.mockResolvedValue({ id: "lnk-1", problemId: "other" });
      await expect(service.unlink("prob-1", "lnk-1", ACTOR)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it("unlink deletes and audits", async () => {
      prisma.problemLink.findUnique.mockResolvedValue({ id: "lnk-1", problemId: "prob-1" });

      await service.unlink("prob-1", "lnk-1", ACTOR);

      expect(prisma.problemLink.delete).toHaveBeenCalledWith({ where: { id: "lnk-1" } });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: "PROBLEM_UNLINKED" }),
        prisma,
      );
    });
  });
});
