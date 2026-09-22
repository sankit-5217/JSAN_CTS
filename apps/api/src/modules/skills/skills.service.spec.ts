import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../common/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { SkillsService } from "./skills.service";

const ACTOR = { actorId: "manager-1", correlationId: "corr-1" };

function baseSkill(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "skill-1",
    name: "Windows",
    isActive: true,
    ...overrides,
  };
}

function makeService(
  overrides: {
    skillFindMany?: jest.Mock;
    skillFindUnique?: jest.Mock;
    skillFindFirst?: jest.Mock;
    userFindUnique?: jest.Mock;
    userSkillFindUnique?: jest.Mock;
    userSkillFindMany?: jest.Mock;
    categoryReqFindMany?: jest.Mock;
    categoryReqFindFirst?: jest.Mock;
    categoryReqFindUnique?: jest.Mock;
  } = {},
) {
  const txSkill = {
    create: jest
      .fn()
      .mockImplementation(({ data }) => Promise.resolve({ ...baseSkill(), ...data })),
    update: jest
      .fn()
      .mockImplementation(({ data }) => Promise.resolve({ ...baseSkill(), ...data })),
  };
  const txUserSkill = {
    create: jest.fn().mockImplementation(({ data }) =>
      Promise.resolve({ id: "assignment-1", createdAt: new Date(), ...data }),
    ),
    delete: jest.fn().mockResolvedValue(undefined),
  };
  const txCategoryReq = {
    create: jest.fn().mockImplementation(({ data }) =>
      Promise.resolve({ id: "requirement-1", createdAt: new Date(), ...data }),
    ),
    delete: jest.fn().mockResolvedValue(undefined),
  };
  const tx = { skill: txSkill, userSkill: txUserSkill, categorySkillRequirement: txCategoryReq };

  const prisma = {
    $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn(tx)),
    skill: {
      findMany: overrides.skillFindMany ?? jest.fn().mockResolvedValue([]),
      findUnique: overrides.skillFindUnique ?? jest.fn().mockResolvedValue(baseSkill()),
      findFirst: overrides.skillFindFirst ?? jest.fn().mockResolvedValue(null),
    },
    user: {
      findUnique: overrides.userFindUnique ?? jest.fn().mockResolvedValue({
        id: "eng-1",
        displayName: "Rahul",
      }),
    },
    userSkill: {
      findUnique: overrides.userSkillFindUnique ?? jest.fn().mockResolvedValue(null),
      findMany: overrides.userSkillFindMany ?? jest.fn().mockResolvedValue([]),
    },
    categorySkillRequirement: {
      findMany: overrides.categoryReqFindMany ?? jest.fn().mockResolvedValue([]),
      findFirst: overrides.categoryReqFindFirst ?? jest.fn().mockResolvedValue(null),
      findUnique:
        overrides.categoryReqFindUnique ??
        jest.fn().mockResolvedValue({ id: "requirement-1", category: "DATABASE", skillId: "skill-1" }),
    },
  } as unknown as PrismaService;

  const auditService = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;

  return { service: new SkillsService(prisma, auditService), prisma, auditService, tx };
}

describe("SkillsService.createSkill", () => {
  it("creates a skill and audits it", async () => {
    const { service, tx, auditService } = makeService();
    const result = await service.createSkill({ name: "Windows" }, ACTOR);

    expect(result).toMatchObject({ name: "Windows" });
    expect(tx.skill.create).toHaveBeenCalledWith({ data: { name: "Windows" } });
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: "Skill", action: "CREATE" }),
      tx,
    );
  });

  it("rejects a case-insensitive duplicate name", async () => {
    const { service } = makeService({
      skillFindFirst: jest.fn().mockResolvedValue(baseSkill({ name: "windows" })),
    });
    await expect(service.createSkill({ name: "Windows" }, ACTOR)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it("trims whitespace from the name", async () => {
    const { service, tx } = makeService();
    await service.createSkill({ name: "  Storage  " }, ACTOR);
    expect(tx.skill.create).toHaveBeenCalledWith({ data: { name: "Storage" } });
  });
});

describe("SkillsService.updateSkill", () => {
  it("404s an unknown skill", async () => {
    const { service } = makeService({ skillFindUnique: jest.fn().mockResolvedValue(null) });
    await expect(service.updateSkill("missing", { isActive: false }, ACTOR)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("can soft-deactivate a skill without deleting it", async () => {
    const { service, tx } = makeService();
    await service.updateSkill("skill-1", { isActive: false }, ACTOR);
    expect(tx.skill.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ isActive: false }) }),
    );
  });

  it("rejects renaming to a name that collides with another skill", async () => {
    const { service } = makeService({
      skillFindFirst: jest.fn().mockResolvedValue(baseSkill({ id: "skill-2", name: "Storage" })),
    });
    await expect(service.updateSkill("skill-1", { name: "Storage" }, ACTOR)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it("allows updating a skill without renaming it (no self-collision)", async () => {
    const { service, tx } = makeService();
    await service.updateSkill("skill-1", { name: "Windows" }, ACTOR);
    expect(tx.skill.update).toHaveBeenCalled();
  });
});

describe("SkillsService.assignSkill", () => {
  it("assigns a skill to an engineer and audits it", async () => {
    const { service, tx, auditService } = makeService();
    await service.assignSkill("skill-1", { userId: "eng-1" }, ACTOR);
    expect(tx.userSkill.create).toHaveBeenCalledWith({
      data: { userId: "eng-1", skillId: "skill-1" },
    });
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: "UserSkill", action: "CREATE" }),
      tx,
    );
  });

  it("rejects an unknown engineer", async () => {
    const { service } = makeService({ userFindUnique: jest.fn().mockResolvedValue(null) });
    await expect(service.assignSkill("skill-1", { userId: "ghost" }, ACTOR)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it("rejects assigning a retired skill", async () => {
    const { service } = makeService({
      skillFindUnique: jest.fn().mockResolvedValue(baseSkill({ isActive: false })),
    });
    await expect(service.assignSkill("skill-1", { userId: "eng-1" }, ACTOR)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it("rejects a duplicate assignment", async () => {
    const { service } = makeService({
      userSkillFindUnique: jest
        .fn()
        .mockResolvedValue({ id: "existing", userId: "eng-1", skillId: "skill-1" }),
    });
    await expect(service.assignSkill("skill-1", { userId: "eng-1" }, ACTOR)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});

describe("SkillsService.unassignSkill", () => {
  it("404s when the engineer doesn't have that skill", async () => {
    const { service } = makeService({ userSkillFindUnique: jest.fn().mockResolvedValue(null) });
    await expect(service.unassignSkill("skill-1", "eng-1", ACTOR)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("removes the assignment and audits the deletion", async () => {
    const existing = { id: "assignment-1", userId: "eng-1", skillId: "skill-1" };
    const { service, tx, auditService } = makeService({
      userSkillFindUnique: jest.fn().mockResolvedValue(existing),
    });
    await service.unassignSkill("skill-1", "eng-1", ACTOR);
    expect(tx.userSkill.delete).toHaveBeenCalledWith({ where: { id: "assignment-1" } });
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: "UserSkill", action: "DELETE" }),
      tx,
    );
  });
});

describe("SkillsService.findAllSkills", () => {
  it("filters to active-only when requested", async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const { service } = makeService({ skillFindMany: findMany });
    await service.findAllSkills(true);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isActive: true } }),
    );
  });

  it("returns everything when not filtered", async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const { service } = makeService({ skillFindMany: findMany });
    await service.findAllSkills(false);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: undefined }));
  });
});

describe("SkillsService.createCategoryRequirement", () => {
  it("creates a requirement and audits it", async () => {
    const { service, tx, auditService } = makeService();
    await service.createCategoryRequirement({ category: "DATABASE", skillId: "skill-1" }, ACTOR);
    expect(tx.categorySkillRequirement.create).toHaveBeenCalledWith({
      data: { category: "DATABASE", skillId: "skill-1" },
    });
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: "CategorySkillRequirement", action: "CREATE" }),
      tx,
    );
  });

  it("trims whitespace from the category", async () => {
    const { service, tx } = makeService();
    await service.createCategoryRequirement({ category: "  Storage  ", skillId: "skill-1" }, ACTOR);
    expect(tx.categorySkillRequirement.create).toHaveBeenCalledWith({
      data: { category: "Storage", skillId: "skill-1" },
    });
  });

  it("rejects an unknown skill", async () => {
    const { service } = makeService({ skillFindUnique: jest.fn().mockResolvedValue(null) });
    await expect(
      service.createCategoryRequirement({ category: "DATABASE", skillId: "ghost" }, ACTOR),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("rejects requiring a retired skill", async () => {
    const { service } = makeService({
      skillFindUnique: jest.fn().mockResolvedValue(baseSkill({ isActive: false })),
    });
    await expect(
      service.createCategoryRequirement({ category: "DATABASE", skillId: "skill-1" }, ACTOR),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects a case-insensitive duplicate (category, skill) pair", async () => {
    const { service } = makeService({
      categoryReqFindFirst: jest
        .fn()
        .mockResolvedValue({ id: "existing", category: "database", skillId: "skill-1" }),
    });
    await expect(
      service.createCategoryRequirement({ category: "DATABASE", skillId: "skill-1" }, ACTOR),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe("SkillsService.deleteCategoryRequirement", () => {
  it("404s an unknown requirement", async () => {
    const { service } = makeService({ categoryReqFindUnique: jest.fn().mockResolvedValue(null) });
    await expect(service.deleteCategoryRequirement("missing", ACTOR)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("removes the requirement and audits the deletion", async () => {
    const { service, tx, auditService } = makeService();
    await service.deleteCategoryRequirement("requirement-1", ACTOR);
    expect(tx.categorySkillRequirement.delete).toHaveBeenCalledWith({
      where: { id: "requirement-1" },
    });
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: "CategorySkillRequirement", action: "DELETE" }),
      tx,
    );
  });
});

describe("SkillsService.findAllCategoryRequirements", () => {
  it("orders by category then creation time", async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const { service } = makeService({ categoryReqFindMany: findMany });
    await service.findAllCategoryRequirements();
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: { skill: true },
        orderBy: [{ category: "asc" }, { createdAt: "asc" }],
      }),
    );
  });
});
