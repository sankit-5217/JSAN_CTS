import { ConflictException, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../common/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { SitesService } from "../sites/sites.service";
import { CategoryTeamsService } from "./category-teams.service";

const ACTOR = { actorId: "admin-1", correlationId: "corr-1" };
const STORAGE_TEAM = { id: "grp-storage", name: "Storage team", memberIds: ["eng-1"] };

function makeService(
  opts: {
    existing?: Record<string, unknown> | null;
    roster?: typeof STORAGE_TEAM | null;
  } = {},
) {
  const prisma = {
    $transaction: jest.fn(),
    categoryTeam: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: "map-1",
          category: "STORAGE_FAILURE",
          groupId: "grp-storage",
          createdAt: new Date("2026-09-24T00:00:00Z"),
          group: { name: "Storage team" },
        },
      ]),
      findFirst: jest.fn().mockResolvedValue(opts.existing ?? null),
      findUnique: jest.fn().mockResolvedValue(opts.existing ?? null),
      create: jest
        .fn()
        .mockImplementation(({ data }) =>
          Promise.resolve({ id: "map-new", createdAt: new Date("2026-09-24T00:00:00Z"), ...data }),
        ),
      delete: jest.fn().mockResolvedValue(undefined),
    },
  };
  prisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(prisma));
  const auditService = { record: jest.fn().mockResolvedValue(undefined) };
  const sitesService = {
    findGroupRoster: jest
      .fn()
      .mockResolvedValue(opts.roster === undefined ? STORAGE_TEAM : opts.roster),
  };
  const service = new CategoryTeamsService(
    prisma as unknown as PrismaService,
    auditService as unknown as AuditService,
    sitesService as unknown as SitesService,
  );
  return { service, prisma, auditService, sitesService };
}

describe("CategoryTeamsService", () => {
  it("lists mappings with the team name", async () => {
    const { service } = makeService();
    await expect(service.list()).resolves.toEqual([
      expect.objectContaining({ category: "STORAGE_FAILURE", groupName: "Storage team" }),
    ]);
  });

  it("creates a mapping, trimmed, and audits it", async () => {
    const { service, prisma, auditService } = makeService();
    const result = await service.create(
      { category: "  STORAGE_FAILURE ", groupId: "grp-storage" },
      ACTOR,
    );
    expect(prisma.categoryTeam.create).toHaveBeenCalledWith({
      data: { category: "STORAGE_FAILURE", groupId: "grp-storage" },
    });
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: "CategoryTeam", action: "CREATE", actorId: "admin-1" }),
      prisma,
    );
    expect(result).toMatchObject({ groupName: "Storage team" });
  });

  it("refuses a second team for a category, matching case-insensitively", async () => {
    const { service, prisma } = makeService({
      existing: { id: "map-1", category: "STORAGE_FAILURE", groupId: "grp-other" },
    });
    await expect(
      service.create({ category: "storage_failure", groupId: "grp-storage" }, ACTOR),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.categoryTeam.findFirst).toHaveBeenCalledWith({
      where: { category: { equals: "storage_failure", mode: "insensitive" } },
    });
  });

  it("404s for an unknown team", async () => {
    const { service } = makeService({ roster: null });
    await expect(
      service.create({ category: "X", groupId: "grp-missing" }, ACTOR),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("removes a mapping and audits it", async () => {
    const existing = { id: "map-1", category: "STORAGE_FAILURE", groupId: "grp-storage" };
    const { service, prisma, auditService } = makeService({ existing });
    await service.remove("map-1", ACTOR);
    expect(prisma.categoryTeam.delete).toHaveBeenCalledWith({ where: { id: "map-1" } });
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "DELETE", before: existing }),
      prisma,
    );
  });

  it("404s removing a mapping that doesn't exist", async () => {
    const { service } = makeService({ existing: null });
    await expect(service.remove("nope", ACTOR)).rejects.toBeInstanceOf(NotFoundException);
  });

  it("resolves a category's team roster, or null with no mapping", async () => {
    const mapped = makeService({
      existing: { id: "map-1", category: "STORAGE_FAILURE", groupId: "grp-storage" },
    });
    await expect(mapped.service.teamForCategory("Storage_Failure")).resolves.toEqual(STORAGE_TEAM);
    expect(mapped.sitesService.findGroupRoster).toHaveBeenCalledWith("grp-storage");

    const unmapped = makeService({ existing: null });
    await expect(unmapped.service.teamForCategory("OTHER")).resolves.toBeNull();
  });
});
