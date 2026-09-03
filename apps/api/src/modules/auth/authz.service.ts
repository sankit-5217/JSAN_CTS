import { Injectable } from "@nestjs/common";
import { UserRole } from "@prisma/client";
import { PrismaService } from "../../common/prisma/prisma.service";
import { AuthenticatedUser } from "./types/jwt-payload.type";

/**
 * Roles that see every site without needing UserSiteAccess rows — matches
 * the "Typical Access" column of the role table in spec §4 (Super Admin:
 * "all data"; Delivery/Operations Manager: "cross-site dashboards";
 * Auditor: "read-only" evidence across everything).
 */
const ALL_SITES_ROLES: ReadonlySet<UserRole> = new Set([
  UserRole.SUPER_ADMIN,
  UserRole.DELIVERY_OPS_MANAGER,
  UserRole.AUDITOR_READ_ONLY,
]);

@Injectable()
export class AuthzService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * `null` means "all sites" — every list/detail query should skip
   * filtering entirely for these roles rather than filtering to an
   * artificially large explicit list.
   */
  async getAccessibleSiteIds(user: AuthenticatedUser): Promise<string[] | null> {
    if (ALL_SITES_ROLES.has(user.role)) {
      return null;
    }
    const grants = await this.prisma.userSiteAccess.findMany({
      where: { userId: user.id },
      select: { siteId: true },
    });
    return grants.map((g) => g.siteId);
  }

  /** True if the user may access the given site (SUPER_ADMIN etc. always can). */
  async canAccessSite(user: AuthenticatedUser, siteId: string): Promise<boolean> {
    const accessible = await this.getAccessibleSiteIds(user);
    return accessible === null || accessible.includes(siteId);
  }
}
