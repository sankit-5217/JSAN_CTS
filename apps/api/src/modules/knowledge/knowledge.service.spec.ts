import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../common/prisma/prisma.service";
import { KnowledgeService } from "./knowledge.service";

type PrismaMock = {
  knowledgeArticle: {
    create: jest.Mock;
    findMany: jest.Mock;
    findUnique: jest.Mock;
    update: jest.Mock;
  };
};

function createPrismaMock(): PrismaMock {
  return {
    knowledgeArticle: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };
}

const FUTURE = "2099-01-01T00:00:00.000Z";
const PAST = "2020-01-01T00:00:00.000Z";
const OWNER = "11111111-1111-1111-1111-111111111111";
const REVIEWER = "22222222-2222-2222-2222-222222222222";

function storedArticle(overrides: Record<string, unknown> = {}) {
  return {
    id: "art-1",
    title: "Replace a failed PSU",
    body: "1. pre-checks\n2. swap",
    version: 1,
    ownerId: null,
    approvalState: "DRAFT",
    reviewDueAt: null as Date | null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("KnowledgeService", () => {
  let prisma: PrismaMock;
  let service: KnowledgeService;

  beforeEach(() => {
    prisma = createPrismaMock();
    service = new KnowledgeService(prisma as unknown as PrismaService);
  });

  describe("create", () => {
    it("creates a DRAFT article that is not authoritative", async () => {
      prisma.knowledgeArticle.create.mockResolvedValue(storedArticle());
      const result = await service.create({ title: "T", body: "B" });
      expect(prisma.knowledgeArticle.create).toHaveBeenCalledTimes(1);
      expect(result.approvalState).toBe("DRAFT");
      expect(result.authoritative).toBe(false);
    });
  });

  describe("list", () => {
    it("matches q against title and body case-insensitively", async () => {
      prisma.knowledgeArticle.findMany.mockResolvedValue([]);
      await service.list({ q: "psu" });
      const where = prisma.knowledgeArticle.findMany.mock.calls[0][0].where;
      expect(where.AND).toContainEqual({
        OR: [
          { title: { contains: "psu", mode: "insensitive" } },
          { body: { contains: "psu", mode: "insensitive" } },
        ],
      });
    });

    it("keeps the q filter alongside a view filter", async () => {
      prisma.knowledgeArticle.findMany.mockResolvedValue([]);
      await service.list({ q: "psu", view: "authoritative" });
      const where = prisma.knowledgeArticle.findMany.mock.calls[0][0].where;
      expect(where.AND).toHaveLength(2);
    });

    it("view=authoritative filters to APPROVED with an unexpired review date", async () => {
      prisma.knowledgeArticle.findMany.mockResolvedValue([]);
      const before = Date.now();
      await service.list({ view: "authoritative" });
      const clause = prisma.knowledgeArticle.findMany.mock.calls[0][0].where.AND[0];
      expect(clause.approvalState).toBe("APPROVED");
      expect(clause.OR[0]).toEqual({ reviewDueAt: null });
      expect(clause.OR[1].reviewDueAt.gte.getTime()).toBeGreaterThanOrEqual(before);
    });

    it("view=review-overdue filters to APPROVED with a past review date", async () => {
      prisma.knowledgeArticle.findMany.mockResolvedValue([]);
      await service.list({ view: "review-overdue" });
      const clause = prisma.knowledgeArticle.findMany.mock.calls[0][0].where.AND[0];
      expect(clause.approvalState).toBe("APPROVED");
      expect(clause.reviewDueAt.lt).toBeInstanceOf(Date);
    });
  });

  describe("getOne", () => {
    it("404s an unknown article", async () => {
      prisma.knowledgeArticle.findUnique.mockResolvedValue(null);
      await expect(service.getOne("missing")).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("update", () => {
    it("bumps the version and reverts to DRAFT when the body changes", async () => {
      prisma.knowledgeArticle.findUnique.mockResolvedValue(
        storedArticle({ approvalState: "APPROVED", reviewDueAt: new Date(FUTURE) }),
      );
      prisma.knowledgeArticle.update.mockResolvedValue(storedArticle({ version: 2 }));
      await service.update("art-1", { body: "rewritten" });
      const data = prisma.knowledgeArticle.update.mock.calls[0][0].data;
      expect(data.version).toEqual({ increment: 1 });
      expect(data.approvalState).toBe("DRAFT");
      expect(data.reviewDueAt).toBeNull();
    });

    it("does not touch version or approval for an owner-only edit", async () => {
      prisma.knowledgeArticle.findUnique.mockResolvedValue(
        storedArticle({ approvalState: "APPROVED" }),
      );
      prisma.knowledgeArticle.update.mockResolvedValue(storedArticle());
      await service.update("art-1", { ownerId: OWNER });
      const data = prisma.knowledgeArticle.update.mock.calls[0][0].data;
      expect(data.version).toBeUndefined();
      expect(data.approvalState).toBeUndefined();
      expect(data.ownerId).toBe(OWNER);
    });

    it("passes a review-date-only edit through as a Date", async () => {
      prisma.knowledgeArticle.findUnique.mockResolvedValue(
        storedArticle({ approvalState: "APPROVED" }),
      );
      prisma.knowledgeArticle.update.mockResolvedValue(storedArticle());
      await service.update("art-1", { reviewDueAt: FUTURE });
      const data = prisma.knowledgeArticle.update.mock.calls[0][0].data;
      expect(data.reviewDueAt).toEqual(new Date(FUTURE));
      expect(data.version).toBeUndefined();
    });
  });

  describe("approve", () => {
    it("409s an already-approved article", async () => {
      prisma.knowledgeArticle.findUnique.mockResolvedValue(
        storedArticle({ approvalState: "APPROVED" }),
      );
      await expect(
        service.approve("art-1", { approverId: REVIEWER, reviewDueAt: FUTURE }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it("rejects self-approval by the owner", async () => {
      prisma.knowledgeArticle.findUnique.mockResolvedValue(storedArticle({ ownerId: OWNER }));
      await expect(
        service.approve("art-1", { approverId: OWNER, reviewDueAt: FUTURE }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("rejects a review date in the past", async () => {
      prisma.knowledgeArticle.findUnique.mockResolvedValue(storedArticle());
      await expect(
        service.approve("art-1", { approverId: REVIEWER, reviewDueAt: PAST }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("sets APPROVED with the review date and returns it authoritative", async () => {
      prisma.knowledgeArticle.findUnique.mockResolvedValue(storedArticle());
      prisma.knowledgeArticle.update.mockResolvedValue(
        storedArticle({ approvalState: "APPROVED", reviewDueAt: new Date(FUTURE) }),
      );
      const result = await service.approve("art-1", { approverId: REVIEWER, reviewDueAt: FUTURE });
      expect(prisma.knowledgeArticle.update).toHaveBeenCalledWith({
        where: { id: "art-1" },
        data: { approvalState: "APPROVED", reviewDueAt: new Date(FUTURE) },
      });
      expect(result.authoritative).toBe(true);
    });
  });

  describe("unpublish", () => {
    it("409s an article that is not published", async () => {
      prisma.knowledgeArticle.findUnique.mockResolvedValue(storedArticle());
      await expect(service.unpublish("art-1", { reason: "n/a" })).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it("drops an approved article back to DRAFT and clears the review date", async () => {
      prisma.knowledgeArticle.findUnique.mockResolvedValue(
        storedArticle({ approvalState: "APPROVED", reviewDueAt: new Date(FUTURE) }),
      );
      prisma.knowledgeArticle.update.mockResolvedValue(storedArticle());
      await service.unpublish("art-1", { reason: "step 4 is unsafe" });
      expect(prisma.knowledgeArticle.update.mock.calls[0][0].data).toEqual({
        approvalState: "DRAFT",
        reviewDueAt: null,
      });
    });
  });

  describe("requireAuthoritative", () => {
    it("throws for a DRAFT article", async () => {
      prisma.knowledgeArticle.findUnique.mockResolvedValue(storedArticle());
      await expect(service.requireAuthoritative("art-1")).rejects.toBeInstanceOf(ConflictException);
    });

    it("throws for an approved article whose review is overdue", async () => {
      prisma.knowledgeArticle.findUnique.mockResolvedValue(
        storedArticle({ approvalState: "APPROVED", reviewDueAt: new Date(PAST) }),
      );
      await expect(service.requireAuthoritative("art-1")).rejects.toBeInstanceOf(ConflictException);
    });

    it("returns the article when approved and not overdue", async () => {
      prisma.knowledgeArticle.findUnique.mockResolvedValue(
        storedArticle({ approvalState: "APPROVED", reviewDueAt: new Date(FUTURE) }),
      );
      const result = await service.requireAuthoritative("art-1");
      expect(result.authoritative).toBe(true);
    });
  });
});
