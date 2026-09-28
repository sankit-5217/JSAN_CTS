import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../common/prisma/prisma.service";
import { ListUsersQueryDto } from "./dto/list-users-query.dto";

export interface UserSummary {
  id: string;
  displayName: string;
  email: string;
  role: string;
}

/**
 * Backs the "who can I assign this to" pickers (incident owner, etc.) —
 * deliberately the only user-facing read this module exposes: no idpSubject,
 * no timestamps, nothing beyond what a picker needs to show a name and let
 * the caller submit an id (spec §12: auth owns identity mapping, not a
 * general user-admin surface).
 */
@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: ListUsersQueryDto): Promise<UserSummary[]> {
    const where: Prisma.UserWhereInput = { isActive: true };
    if (query.role) {
      where.role = query.role;
    }
    if (query.siteId) {
      where.siteAccess = { some: { siteId: query.siteId } };
    }
    if (query.q) {
      where.OR = [
        { displayName: { contains: query.q, mode: "insensitive" } },
        { email: { contains: query.q, mode: "insensitive" } },
      ];
    }

    const users = await this.prisma.user.findMany({
      where,
      select: { id: true, displayName: true, email: true, role: true },
      orderBy: { displayName: "asc" },
      take: query.limit,
    });
    return users;
  }

  /** Resolves a single id — used to seed a picker with an already-assigned
   * owner's name instead of showing the raw id. */
  async findOne(id: string): Promise<UserSummary> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, displayName: true, email: true, role: true },
    });
    if (!user) {
      throw new NotFoundException(`User ${id} not found`);
    }
    return user;
  }
}
