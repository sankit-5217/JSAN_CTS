import { NotFoundException } from "@nestjs/common";
import { UserRole } from "@prisma/client";
import { PrismaService } from "../../common/prisma/prisma.service";
import { ListUsersQueryDto } from "./dto/list-users-query.dto";
import { UsersService } from "./users.service";

describe("UsersService", () => {
  function makeService(findManyResult: unknown[] = [], findUniqueResult: unknown = null) {
    const prisma = {
      user: {
        findMany: jest.fn().mockResolvedValue(findManyResult),
        findUnique: jest.fn().mockResolvedValue(findUniqueResult),
      },
    } as unknown as PrismaService;
    return { service: new UsersService(prisma), prisma };
  }

  it("always filters to active users", async () => {
    const { service, prisma } = makeService();
    await service.findAll({} as ListUsersQueryDto);
    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isActive: true } }),
    );
  });

  it("filters by role when given", async () => {
    const { service, prisma } = makeService();
    await service.findAll({ role: UserRole.SITE_ENGINEER } as ListUsersQueryDto);
    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isActive: true, role: UserRole.SITE_ENGINEER } }),
    );
  });

  it("filters to users with UserSiteAccess for the given site", async () => {
    const { service, prisma } = makeService();
    await service.findAll({ siteId: "site-1" } as ListUsersQueryDto);
    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { isActive: true, siteAccess: { some: { siteId: "site-1" } } },
      }),
    );
  });

  it("searches displayName/email case-insensitively when q is given", async () => {
    const { service, prisma } = makeService();
    await service.findAll({ q: "engi" } as ListUsersQueryDto);
    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          isActive: true,
          OR: [
            { displayName: { contains: "engi", mode: "insensitive" } },
            { email: { contains: "engi", mode: "insensitive" } },
          ],
        },
      }),
    );
  });

  it("only selects picker-safe fields, never idpSubject or timestamps", async () => {
    const { service, prisma } = makeService();
    await service.findAll({} as ListUsersQueryDto);
    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: { id: true, displayName: true, email: true, role: true },
      }),
    );
  });

  it("returns whatever Prisma resolves", async () => {
    const rows = [
      { id: "u1", displayName: "Eng One", email: "eng1@example.com", role: "SITE_ENGINEER" },
    ];
    const { service } = makeService(rows);
    await expect(service.findAll({} as ListUsersQueryDto)).resolves.toEqual(rows);
  });

  describe("findOne", () => {
    it("returns the user when found", async () => {
      const row = {
        id: "u1",
        displayName: "Eng One",
        email: "eng1@example.com",
        role: "SITE_ENGINEER",
      };
      const { service } = makeService([], row);
      await expect(service.findOne("u1")).resolves.toEqual(row);
    });

    it("throws NotFoundException when the id doesn't exist", async () => {
      const { service } = makeService([], null);
      await expect(service.findOne("missing")).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
