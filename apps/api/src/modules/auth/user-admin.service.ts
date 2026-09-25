import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { Prisma, UserRole } from "@prisma/client";
import { randomUUID } from "crypto";
import { PrismaService } from "../../common/prisma/prisma.service";
import { ActorContext } from "../../common/types/actor-context.type";
import { AuditService } from "../audit/audit.service";
import { isAllSitesRole } from "./authz.service";
import {
  CreateAdminUserDto,
  ListAdminUsersQueryDto,
  SetUserSitesDto,
  UpdateAdminUserDto,
} from "./dto/admin-user.dto";
import {
  USER_DEACTIVATION_CHECK_EVENT,
  USER_ROLE_CHANGE_CHECK_EVENT,
  UserChangeBlocker,
  UserDeactivationCheck,
  UserRoleChangeCheck,
} from "./user-change-checks";

/** What the Users admin screen sees — never idpSubject/idpIssuer themselves. */
export interface AdminUserView {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  isActive: boolean;
  /** Linked to an SSO identity (email is then locked). */
  ssoLinked: boolean;
  /** Role sees every site regardless of `siteIds`. */
  allSites: boolean;
  siteIds: string[];
  createdAt: Date;
  updatedAt: Date;
}

const USER_SELECT = {
  id: true,
  email: true,
  displayName: true,
  role: true,
  isActive: true,
  idpIssuer: true,
  createdAt: true,
  updatedAt: true,
  siteAccess: { select: { siteId: true } },
} satisfies Prisma.UserSelect;

type UserRow = Prisma.UserGetPayload<{ select: typeof USER_SELECT }>;

/**
 * User administration (spec §4, §12: auth owns identity mapping and roles).
 * SUPER_ADMIN-only at the controller. Users are never deleted — deactivated
 * instead (audit rule) — and every mutation is audited in its transaction.
 *
 * Changes that would strand another module's data are vetoed by that
 * module (see user-change-checks.ts): deactivating someone who still owns
 * open incidents, or moving an engineer with skills/active shifts to a
 * non-engineer role.
 *
 * No "last Super Admin" check is needed: only an active Super Admin can
 * call this, and nobody may change their own role or deactivate themselves,
 * so at least one active Super Admin (the caller) always remains.
 */
@Injectable()
export class UserAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: EventEmitter2,
  ) {}

  async list(query: ListAdminUsersQueryDto): Promise<AdminUserView[]> {
    const where: Prisma.UserWhereInput = {};
    if (query.role) where.role = query.role;
    if (query.status === "active") where.isActive = true;
    if (query.status === "inactive") where.isActive = false;
    if (query.q?.trim()) {
      const q = query.q.trim();
      where.OR = [
        { displayName: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
      ];
    }
    const rows = await this.prisma.user.findMany({
      where,
      select: USER_SELECT,
      orderBy: [{ isActive: "desc" }, { displayName: "asc" }],
    });
    return rows.map(toView);
  }

  async findOne(id: string): Promise<AdminUserView> {
    return toView(await this.findRow(id));
  }

  async create(dto: CreateAdminUserDto, actor: ActorContext): Promise<AdminUserView> {
    await this.assertEmailFree(dto.email);
    const siteIds = dto.siteIds ?? [];
    const created = await this.writeOrTranslate(() =>
      this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            email: dto.email,
            displayName: dto.displayName,
            role: dto.role,
            // Placeholder until the first SSO login links the real (issuer, subject).
            idpSubject: `pending|${randomUUID()}`,
            siteAccess: { create: siteIds.map((siteId) => ({ siteId })) },
          },
          select: USER_SELECT,
        });
        await this.audit.record(
          {
            actorId: actor.actorId,
            entityType: "USER",
            entityId: user.id,
            action: "USER_CREATED",
            after: auditShape(user),
            correlationId: actor.correlationId,
          },
          tx,
        );
        return user;
      }),
    );
    return toView(created);
  }

  async update(id: string, dto: UpdateAdminUserDto, actor: ActorContext): Promise<AdminUserView> {
    const before = await this.findRow(id);
    const roleChanging = dto.role !== undefined && dto.role !== before.role;
    const emailChanging = dto.email !== undefined && dto.email !== before.email;

    if (roleChanging && id === actor.actorId) {
      throw new BadRequestException("You can't change your own role");
    }
    if (emailChanging) {
      if (before.idpIssuer !== null) {
        throw new BadRequestException(
          "Email is locked once the user has signed in with SSO — it's matched to their SSO identity",
        );
      }
      await this.assertEmailFree(dto.email!, id);
    }
    if (roleChanging) {
      await this.assertNoBlockers<UserRoleChangeCheck>(
        USER_ROLE_CHANGE_CHECK_EVENT,
        { userId: id, fromRole: before.role, toRole: dto.role! },
        `Can't change ${before.displayName}'s role`,
      );
    }

    const after = await this.writeOrTranslate(() =>
      this.prisma.$transaction(async (tx) => {
        const updated = await tx.user.update({
          where: { id },
          data: { email: dto.email, displayName: dto.displayName, role: dto.role },
          select: USER_SELECT,
        });
        await this.audit.record(
          {
            actorId: actor.actorId,
            entityType: "USER",
            entityId: id,
            action: "USER_UPDATED",
            before: auditShape(before),
            after: auditShape(updated),
            correlationId: actor.correlationId,
          },
          tx,
        );
        return updated;
      }),
    );
    return toView(after);
  }

  /** Replaces the user's site grants with exactly `siteIds`. */
  async setSites(id: string, dto: SetUserSitesDto, actor: ActorContext): Promise<AdminUserView> {
    const before = await this.findRow(id);
    const current = new Set(before.siteAccess.map((a) => a.siteId));
    const wanted = new Set(dto.siteIds);
    const toAdd = dto.siteIds.filter((s) => !current.has(s));
    const toRemove = [...current].filter((s) => !wanted.has(s));
    if (toAdd.length === 0 && toRemove.length === 0) {
      return toView(before);
    }

    const after = await this.writeOrTranslate(() =>
      this.prisma.$transaction(async (tx) => {
        await tx.userSiteAccess.deleteMany({ where: { userId: id, siteId: { in: toRemove } } });
        await tx.userSiteAccess.createMany({
          data: toAdd.map((siteId) => ({ userId: id, siteId })),
        });
        const updated = await tx.user.findUniqueOrThrow({ where: { id }, select: USER_SELECT });
        await this.audit.record(
          {
            actorId: actor.actorId,
            entityType: "USER",
            entityId: id,
            action: "USER_SITE_ACCESS_CHANGED",
            before: { siteIds: [...current].sort() },
            after: { siteIds: [...wanted].sort(), added: toAdd, removed: toRemove },
            correlationId: actor.correlationId,
          },
          tx,
        );
        return updated;
      }),
    );
    return toView(after);
  }

  async deactivate(id: string, actor: ActorContext): Promise<AdminUserView> {
    if (id === actor.actorId) {
      throw new BadRequestException("You can't deactivate your own account");
    }
    const before = await this.findRow(id);
    if (!before.isActive) {
      throw new ConflictException(`${before.displayName} is already inactive`);
    }
    await this.assertNoBlockers<UserDeactivationCheck>(
      USER_DEACTIVATION_CHECK_EVENT,
      { userId: id },
      `Can't deactivate ${before.displayName}`,
    );
    return this.setActive(before, false, actor);
  }

  async reactivate(id: string, actor: ActorContext): Promise<AdminUserView> {
    const before = await this.findRow(id);
    if (before.isActive) {
      throw new ConflictException(`${before.displayName} is already active`);
    }
    return this.setActive(before, true, actor);
  }

  private async setActive(
    before: UserRow,
    isActive: boolean,
    actor: ActorContext,
  ): Promise<AdminUserView> {
    const after = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id: before.id },
        data: { isActive },
        select: USER_SELECT,
      });
      await this.audit.record(
        {
          actorId: actor.actorId,
          entityType: "USER",
          entityId: before.id,
          action: isActive ? "USER_REACTIVATED" : "USER_DEACTIVATED",
          before: { isActive: before.isActive },
          after: { isActive },
          correlationId: actor.correlationId,
        },
        tx,
      );
      return updated;
    });
    return toView(after);
  }

  /** Asks the owning modules; any blocker turns into a 409 listing them all. */
  private async assertNoBlockers<T>(event: string, payload: T, summary: string): Promise<void> {
    const answers = (await this.events.emitAsync(event, payload)) as (UserChangeBlocker | null)[];
    const blockers = answers.filter((b): b is UserChangeBlocker => !!b);
    if (blockers.length > 0) {
      throw new ConflictException({
        statusCode: 409,
        error: "Conflict",
        message: `${summary}: ${blockers.map((b) => b.message).join("; ")}`,
        blockers,
      });
    }
  }

  private async assertEmailFree(email: string, exceptUserId?: string): Promise<void> {
    const clash = await this.prisma.user.findFirst({
      where: {
        email: { equals: email, mode: "insensitive" },
        ...(exceptUserId ? { id: { not: exceptUserId } } : {}),
      },
      select: { id: true },
    });
    if (clash) {
      throw new ConflictException(`A user with email ${email} already exists`);
    }
  }

  private async findRow(id: string): Promise<UserRow> {
    const row = await this.prisma.user.findUnique({ where: { id }, select: USER_SELECT });
    if (!row) throw new NotFoundException(`User ${id} not found`);
    return row;
  }

  /** Maps DB constraint races to client errors instead of a 500. */
  private async writeOrTranslate<T>(write: () => Promise<T>): Promise<T> {
    try {
      return await write();
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError) {
        if (err.code === "P2002")
          throw new ConflictException("A user with that email already exists");
        if (err.code === "P2003") throw new BadRequestException("One or more site ids don't exist");
      }
      throw err;
    }
  }
}

function toView(row: UserRow): AdminUserView {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    role: row.role,
    isActive: row.isActive,
    ssoLinked: row.idpIssuer !== null,
    allSites: isAllSitesRole(row.role),
    siteIds: row.siteAccess.map((a) => a.siteId).sort(),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function auditShape(row: UserRow) {
  return {
    email: row.email,
    displayName: row.displayName,
    role: row.role,
    isActive: row.isActive,
    siteIds: row.siteAccess.map((a) => a.siteId).sort(),
  };
}
