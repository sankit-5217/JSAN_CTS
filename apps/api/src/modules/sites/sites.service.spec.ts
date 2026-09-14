import { NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../common/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { SitesService } from "./sites.service";

function makeService(prismaOverrides: Record<string, unknown> = {}) {
  const tx = {
    supportGroupMember: {
      upsert: jest
        .fn()
        .mockImplementation(({ create }) => Promise.resolve({ id: "member-1", ...create })),
      delete: jest.fn().mockResolvedValue(undefined),
    },
  };
  const prisma = {
    $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn(tx)),
    supportGroup: { findUnique: jest.fn().mockResolvedValue(null) },
    supportGroupMember: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
    },
    user: { findUnique: jest.fn().mockResolvedValue(null) },
    ...prismaOverrides,
  } as unknown as PrismaService;
  const auditService = {
    record: jest.fn().mockResolvedValue(undefined),
  } as unknown as AuditService;
  return { service: new SitesService(prisma, auditService), prisma, auditService, tx };
}

describe("SitesService.create", () => {
  it("creates the site and audits it inside the same transaction", async () => {
    const createdSite = {
      id: "site-1",
      code: "SITE01",
      name: "Demo",
      timezone: "UTC",
      is247: false,
    };
    const tx = { site: { create: jest.fn().mockResolvedValue(createdSite) } };
    const prisma = {
      $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn(tx)),
    } as unknown as PrismaService;
    const auditService = {
      record: jest.fn().mockResolvedValue(undefined),
    } as unknown as AuditService;

    const service = new SitesService(prisma, auditService);
    const result = await service.create(
      { code: "SITE01", name: "Demo", timezone: "UTC", is247: false },
      { actorId: "user-1", correlationId: "corr-1" },
    );

    expect(result).toBe(createdSite);
    expect(tx.site.create).toHaveBeenCalledWith({
      data: { code: "SITE01", name: "Demo", timezone: "UTC", is247: false },
    });
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: "user-1",
        entityType: "Site",
        entityId: "site-1",
        action: "CREATE",
        after: createdSite,
        correlationId: "corr-1",
      }),
      tx,
    );
  });
});

describe("SitesService support group membership", () => {
  const groupId = "group-1";
  const group = { id: groupId, name: "Networking", createdAt: new Date() };
  const user = {
    id: "user-1",
    displayName: "Pat Roe",
    email: "pat@example.com",
    role: "SITE_ENGINEER",
  };

  describe("listGroupMembers", () => {
    it("throws NotFoundException when the group doesn't exist", async () => {
      const { service } = makeService();
      await expect(service.listGroupMembers("missing")).rejects.toBeInstanceOf(NotFoundException);
    });

    it("returns each member's user summary flattened with their membership id", async () => {
      const { service, prisma } = makeService({
        supportGroup: { findUnique: jest.fn().mockResolvedValue(group) },
        supportGroupMember: {
          findMany: jest.fn().mockResolvedValue([{ id: "member-1", user }]),
          findUnique: jest.fn(),
        },
      });
      await expect(service.listGroupMembers(groupId)).resolves.toEqual([
        { membershipId: "member-1", ...user },
      ]);
      expect(prisma.supportGroupMember.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { groupId } }),
      );
    });
  });

  describe("addGroupMember", () => {
    it("throws NotFoundException when the group doesn't exist", async () => {
      const { service } = makeService();
      await expect(
        service.addGroupMember(groupId, { userId: user.id }, { actorId: "actor-1" }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("throws NotFoundException when the user doesn't exist", async () => {
      const { service } = makeService({
        supportGroup: { findUnique: jest.fn().mockResolvedValue(group) },
      });
      await expect(
        service.addGroupMember(groupId, { userId: "missing" }, { actorId: "actor-1" }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("upserts the membership (idempotent) and audits it", async () => {
      const { service, tx, auditService } = makeService({
        supportGroup: { findUnique: jest.fn().mockResolvedValue(group) },
        user: { findUnique: jest.fn().mockResolvedValue(user) },
      });
      const result = await service.addGroupMember(
        groupId,
        { userId: user.id },
        { actorId: "actor-1", correlationId: "corr-1" },
      );
      expect(result).toEqual({ membershipId: "member-1", ...user });
      expect(tx.supportGroupMember.upsert).toHaveBeenCalledWith({
        where: { groupId_userId: { groupId, userId: user.id } },
        create: { groupId, userId: user.id },
        update: {},
      });
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: "actor-1",
          entityType: "SupportGroup",
          entityId: groupId,
          action: "ADD_MEMBER",
          correlationId: "corr-1",
        }),
        tx,
      );
    });
  });

  describe("removeGroupMember", () => {
    it("throws NotFoundException when the group doesn't exist", async () => {
      const { service } = makeService();
      await expect(
        service.removeGroupMember(groupId, user.id, { actorId: "actor-1" }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("throws NotFoundException when the user isn't a member", async () => {
      const { service } = makeService({
        supportGroup: { findUnique: jest.fn().mockResolvedValue(group) },
      });
      await expect(
        service.removeGroupMember(groupId, user.id, { actorId: "actor-1" }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("deletes the membership and audits it", async () => {
      const { service, tx, auditService } = makeService({
        supportGroup: { findUnique: jest.fn().mockResolvedValue(group) },
        supportGroupMember: {
          findMany: jest.fn(),
          findUnique: jest.fn().mockResolvedValue({ id: "member-1", groupId, userId: user.id }),
        },
      });
      await service.removeGroupMember(groupId, user.id, {
        actorId: "actor-1",
        correlationId: "corr-1",
      });
      expect(tx.supportGroupMember.delete).toHaveBeenCalledWith({ where: { id: "member-1" } });
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: "actor-1",
          entityType: "SupportGroup",
          entityId: groupId,
          action: "REMOVE_MEMBER",
          correlationId: "corr-1",
        }),
        tx,
      );
    });
  });
});
