import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { CiType, Criticality, ManagedBy, UserRole } from "@prisma/client";
import { PrismaService } from "../../common/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { AuthzService } from "../auth/authz.service";
import { AuthenticatedUser } from "../auth/types/jwt-payload.type";
import { CmdbService } from "./cmdb.service";

const scopedUser: AuthenticatedUser = {
  id: "user-1",
  email: "engineer@example.com",
  role: UserRole.SITE_ENGINEER,
  isActive: true,
};

const baseCiDto = {
  ciCode: "SITE01-R01-SRV-001",
  siteId: "site-a",
  ciType: CiType.SERVER,
  name: "Server 1",
  managedBy: ManagedBy.JSAN,
  criticality: Criticality.HIGH,
};

function makeService(
  overrides: {
    txConfigurationItem?: Partial<Record<string, jest.Mock>>;
    configurationItemFindUnique?: jest.Mock;
    canAccessSite?: jest.Mock;
    getAccessibleSiteIds?: jest.Mock;
  } = {},
) {
  const txCi = {
    create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: "ci-1", ...data })),
    update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: "ci-1", ...data })),
    ...overrides.txConfigurationItem,
  };
  const tx = {
    configurationItem: txCi,
    ciRelation: {
      create: jest
        .fn()
        .mockImplementation(({ data }) => Promise.resolve({ id: "relation-1", ...data })),
    },
  };

  const prisma = {
    $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn(tx)),
    configurationItem: {
      findUnique:
        overrides.configurationItemFindUnique ??
        jest.fn().mockResolvedValue({ id: "ci-1", siteId: "site-a" }),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    rack: { findMany: jest.fn(), findUnique: jest.fn() },
  } as unknown as PrismaService;

  const auditService = {
    record: jest.fn().mockResolvedValue(undefined),
  } as unknown as AuditService;

  const authzService = {
    canAccessSite: overrides.canAccessSite ?? jest.fn().mockResolvedValue(true),
    getAccessibleSiteIds: overrides.getAccessibleSiteIds ?? jest.fn().mockResolvedValue(null),
  } as unknown as AuthzService;

  return {
    service: new CmdbService(prisma, auditService, authzService),
    prisma,
    auditService,
    authzService,
    tx,
  };
}

describe("CmdbService.create", () => {
  it("creates the CI and audits it inside the same transaction", async () => {
    const { service, tx, auditService } = makeService();
    const result = await service.create(baseCiDto, { actorId: "user-1", correlationId: "corr-1" });

    expect(result).toMatchObject({ id: "ci-1", ciCode: baseCiDto.ciCode });
    expect(tx.configurationItem.create).toHaveBeenCalledTimes(1);
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: "ConfigurationItem", action: "CREATE" }),
      tx,
    );
  });

  it("defaults lifecycleStatus to ACTIVE when not provided", async () => {
    const { service, tx } = makeService();
    await service.create(baseCiDto, { actorId: "user-1" });
    expect(tx.configurationItem.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ lifecycleStatus: "ACTIVE" }) }),
    );
  });
});

describe("CmdbService site-scope enforcement", () => {
  it("findOneScoped throws when the caller can't access the CI's site", async () => {
    const { service } = makeService({ canAccessSite: jest.fn().mockResolvedValue(false) });
    await expect(service.findOneScoped("ci-1", scopedUser)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it("findOneScoped succeeds when the caller can access the CI's site", async () => {
    const { service } = makeService({ canAccessSite: jest.fn().mockResolvedValue(true) });
    await expect(service.findOneScoped("ci-1", scopedUser)).resolves.toMatchObject({
      id: "ci-1",
    });
  });
});

describe("CmdbService.findAll", () => {
  it("scopes to the caller's accessible sites when an explicit ?siteId isn't in scope", async () => {
    const { service, prisma } = makeService();
    await service.findAll({ siteId: "site-not-mine", limit: 50, offset: 0 }, ["site-a", "site-b"]);
    expect(prisma.configurationItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ siteId: { in: ["site-a", "site-b"] } }),
      }),
    );
  });

  it("narrows to just the requested site when it IS in the caller's scope", async () => {
    const { service, prisma } = makeService();
    await service.findAll({ siteId: "site-a", limit: 50, offset: 0 }, ["site-a", "site-b"]);
    expect(prisma.configurationItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ siteId: { in: ["site-a"] } }) }),
    );
  });

  it("applies no site filter for an unrestricted (null) caller", async () => {
    const { service, prisma } = makeService();
    await service.findAll({ limit: 50, offset: 0 }, null);
    expect(prisma.configurationItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ siteId: undefined }) }),
    );
  });
});

describe("CmdbService.bulkCreate", () => {
  it("creates every item in the array, each with its own audit event, in one transaction", async () => {
    const { service, prisma, auditService } = makeService();
    const items = [baseCiDto, { ...baseCiDto, ciCode: "SITE01-R01-SRV-002" }];

    const result = await service.bulkCreate({ items }, { actorId: "user-1" });

    expect(result).toHaveLength(2);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(auditService.record).toHaveBeenCalledTimes(2);
  });
});

describe("CmdbService.createRelation", () => {
  it("rejects a CI relating to itself", async () => {
    const { service } = makeService();
    await expect(
      service.createRelation(
        "ci-1",
        { relatedCiId: "ci-1", relationType: "DEPENDS_ON", direction: "CHILD" },
        { actorId: "user-1" },
        scopedUser,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("resolves parent/child correctly for direction=CHILD (the URL CI is the parent)", async () => {
    const findUnique = jest
      .fn()
      .mockResolvedValueOnce({ id: "ci-1", siteId: "site-a" })
      .mockResolvedValueOnce({ id: "ci-2", siteId: "site-a" });
    const { service, tx } = makeService({ configurationItemFindUnique: findUnique });

    await service.createRelation(
      "ci-1",
      { relatedCiId: "ci-2", relationType: "CONTAINS", direction: "CHILD" },
      { actorId: "user-1" },
      scopedUser,
    );

    expect(tx.ciRelation.create).toHaveBeenCalledWith({
      data: { parentCiId: "ci-1", childCiId: "ci-2", relationType: "CONTAINS" },
    });
  });
});
