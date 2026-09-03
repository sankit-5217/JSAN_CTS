import { UserRole } from "@prisma/client";
import { PrismaService } from "../../common/prisma/prisma.service";
import { AuthzService } from "./authz.service";
import { AuthenticatedUser } from "./types/jwt-payload.type";

describe("AuthzService", () => {
  function makeService(findManyResult: { siteId: string }[] = []) {
    const prisma = {
      userSiteAccess: { findMany: jest.fn().mockResolvedValue(findManyResult) },
    } as unknown as PrismaService;
    return { service: new AuthzService(prisma), prisma };
  }

  const scopedUser: AuthenticatedUser = {
    id: "u1",
    email: "engineer@example.com",
    role: UserRole.SITE_ENGINEER,
    isActive: true,
  };

  it("returns null (unrestricted) for SUPER_ADMIN without querying the DB", async () => {
    const { service, prisma } = makeService();
    const result = await service.getAccessibleSiteIds({
      ...scopedUser,
      role: UserRole.SUPER_ADMIN,
    });
    expect(result).toBeNull();
    expect(prisma.userSiteAccess.findMany).not.toHaveBeenCalled();
  });

  it("returns null for DELIVERY_OPS_MANAGER and AUDITOR_READ_ONLY too", async () => {
    const { service } = makeService();
    await expect(
      service.getAccessibleSiteIds({ ...scopedUser, role: UserRole.DELIVERY_OPS_MANAGER }),
    ).resolves.toBeNull();
    await expect(
      service.getAccessibleSiteIds({ ...scopedUser, role: UserRole.AUDITOR_READ_ONLY }),
    ).resolves.toBeNull();
  });

  it("returns the user's granted site IDs for a scoped role", async () => {
    const { service, prisma } = makeService([{ siteId: "site-a" }, { siteId: "site-b" }]);
    const result = await service.getAccessibleSiteIds(scopedUser);
    expect(result).toEqual(["site-a", "site-b"]);
    expect(prisma.userSiteAccess.findMany).toHaveBeenCalledWith({
      where: { userId: scopedUser.id },
      select: { siteId: true },
    });
  });

  it("returns an empty array (not null) for a scoped user with zero grants", async () => {
    const { service } = makeService([]);
    await expect(service.getAccessibleSiteIds(scopedUser)).resolves.toEqual([]);
  });

  describe("canAccessSite", () => {
    it("is true for an all-sites role regardless of the site", async () => {
      const { service } = makeService();
      const admin = { ...scopedUser, role: UserRole.SUPER_ADMIN };
      await expect(service.canAccessSite(admin, "any-site")).resolves.toBe(true);
    });

    it("is true only when the scoped user's grants include the site", async () => {
      const { service } = makeService([{ siteId: "site-a" }]);
      await expect(service.canAccessSite(scopedUser, "site-a")).resolves.toBe(true);
      await expect(service.canAccessSite(scopedUser, "site-z")).resolves.toBe(false);
    });
  });
});
