import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Site, UserRole } from "@prisma/client";
import { ActorContext } from "../../common/types/actor-context.type";
import { Paginated } from "../../common/types/paginated.type";
import { PrismaService } from "../../common/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { AddSupportGroupMemberDto } from "./dto/add-support-group-member.dto";
import { CreateSiteContactDto } from "./dto/create-site-contact.dto";
import { CreateSiteDto } from "./dto/create-site.dto";
import { CreateSupportCalendarDto } from "./dto/create-support-calendar.dto";
import { CreateSupportGroupDto } from "./dto/create-support-group.dto";
import { ListSitesQueryDto } from "./dto/list-sites-query.dto";

/**
 * Owns: sites, timezone, contacts, support calendars (spec §12).
 * Must not own hardware telemetry or ticket SLA state.
 */
@Injectable()
export class SitesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * `accessibleSiteIds`: `null` (or omitted) = unrestricted (caller has an
   * "all sites" role, see AuthzService); an array = filter to exactly
   * those sites. List endpoints filter rather than 403 — a scoped user
   * asking for "all sites" should just see their sites, not get rejected.
   */
  async findAll(
    query: ListSitesQueryDto,
    accessibleSiteIds?: string[] | null,
  ): Promise<Paginated<Site>> {
    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;
    const where = accessibleSiteIds ? { id: { in: accessibleSiteIds } } : undefined;

    const [items, total] = await Promise.all([
      this.prisma.site.findMany({ where, orderBy: { code: "asc" }, take: limit, skip: offset }),
      this.prisma.site.count({ where }),
    ]);

    return { items, total, limit, offset };
  }

  async findOne(id: string) {
    const site = await this.prisma.site.findUnique({ where: { id } });
    if (!site) {
      throw new NotFoundException(`Site ${id} not found`);
    }
    return site;
  }

  create(dto: CreateSiteDto, actor: ActorContext) {
    return this.prisma.$transaction(async (tx) => {
      const site = await tx.site.create({
        data: {
          code: dto.code,
          name: dto.name,
          timezone: dto.timezone,
          is247: dto.is247 ?? false,
        },
      });
      await this.auditService.record(
        {
          actorId: actor.actorId,
          entityType: "Site",
          entityId: site.id,
          action: "CREATE",
          after: site,
          correlationId: actor.correlationId,
        },
        tx,
      );
      return site;
    });
  }

  // --- Site contacts -------------------------------------------------

  async listContacts(siteId: string) {
    await this.findOne(siteId); // 404s if the site doesn't exist
    return this.prisma.siteContact.findMany({ where: { siteId }, orderBy: { name: "asc" } });
  }

  async createContact(siteId: string, dto: CreateSiteContactDto, actor: ActorContext) {
    await this.findOne(siteId);
    return this.prisma.$transaction(async (tx) => {
      const contact = await tx.siteContact.create({
        data: {
          siteId,
          name: dto.name,
          role: dto.role,
          email: dto.email,
          phone: dto.phone,
          isOnCall: dto.isOnCall ?? false,
        },
      });
      await this.auditService.record(
        {
          actorId: actor.actorId,
          entityType: "SiteContact",
          entityId: contact.id,
          action: "CREATE",
          after: contact,
          correlationId: actor.correlationId,
        },
        tx,
      );
      return contact;
    });
  }

  // --- Support calendars -----------------------------------------------

  async listSupportCalendars(siteId: string) {
    await this.findOne(siteId);
    return this.prisma.supportCalendar.findMany({ where: { siteId }, orderBy: { name: "asc" } });
  }

  async createSupportCalendar(siteId: string, dto: CreateSupportCalendarDto, actor: ActorContext) {
    await this.findOne(siteId);
    return this.prisma.$transaction(async (tx) => {
      const calendar = await tx.supportCalendar.create({
        data: {
          siteId,
          name: dto.name,
          businessStart: dto.businessStart,
          businessEnd: dto.businessEnd,
          workdays: dto.workdays,
          holidays: dto.holidays ?? [],
          is247: dto.is247 ?? false,
        },
      });
      await this.auditService.record(
        {
          actorId: actor.actorId,
          entityType: "SupportCalendar",
          entityId: calendar.id,
          action: "CREATE",
          after: calendar,
          correlationId: actor.correlationId,
        },
        tx,
      );
      return calendar;
    });
  }

  // --- Support groups (not site-scoped) ---------------------------------

  listSupportGroups() {
    return this.prisma.supportGroup.findMany({ orderBy: { name: "asc" } });
  }

  createSupportGroup(dto: CreateSupportGroupDto, actor: ActorContext) {
    return this.prisma.$transaction(async (tx) => {
      const group = await tx.supportGroup.create({ data: { name: dto.name } });
      await this.auditService.record(
        {
          actorId: actor.actorId,
          entityType: "SupportGroup",
          entityId: group.id,
          action: "CREATE",
          after: group,
          correlationId: actor.correlationId,
        },
        tx,
      );
      return group;
    });
  }

  private async getSupportGroup(id: string) {
    const group = await this.prisma.supportGroup.findUnique({ where: { id } });
    if (!group) {
      throw new NotFoundException(`Support group ${id} not found`);
    }
    return group;
  }

  /** Who's actually on a group's roster — this is what
   * IncidentsService.notifyGroupAssignment reads to know who to tell when a
   * ticket lands in this group unassigned. */
  async listGroupMembers(groupId: string) {
    await this.getSupportGroup(groupId);
    const members = await this.prisma.supportGroupMember.findMany({
      where: { groupId },
      include: { user: { select: { id: true, displayName: true, email: true, role: true } } },
      orderBy: { createdAt: "asc" },
    });
    return members.map((m) => ({ membershipId: m.id, ...m.user }));
  }

  async addGroupMember(groupId: string, dto: AddSupportGroupMemberDto, actor: ActorContext) {
    await this.getSupportGroup(groupId);
    const user = await this.prisma.user.findUnique({
      where: { id: dto.userId },
      select: { id: true, displayName: true, email: true, role: true },
    });
    if (!user) {
      throw new NotFoundException(`User ${dto.userId} not found`);
    }
    // A support group's roster is who gets paged for a ticket queue — a
    // customer was never a candidate, and this rejects it server-side
    // rather than just hiding the option in the picker (spec §4: a
    // customer's only writes are their own ticket's comments/attachments).
    if (user.role === UserRole.CTS_MANAGER_VIEWER) {
      throw new BadRequestException("Customers cannot be added to a support group");
    }
    return this.prisma.$transaction(async (tx) => {
      // Idempotent by design — clicking "add" twice on the same person is a
      // no-op, not an error the UI has to swallow.
      const membership = await tx.supportGroupMember.upsert({
        where: { groupId_userId: { groupId, userId: dto.userId } },
        create: { groupId, userId: dto.userId },
        update: {},
      });
      await this.auditService.record(
        {
          actorId: actor.actorId,
          entityType: "SupportGroup",
          entityId: groupId,
          action: "ADD_MEMBER",
          after: { userId: dto.userId, displayName: user.displayName },
          correlationId: actor.correlationId,
        },
        tx,
      );
      return { membershipId: membership.id, ...user };
    });
  }

  async removeGroupMember(groupId: string, userId: string, actor: ActorContext) {
    await this.getSupportGroup(groupId);
    const membership = await this.prisma.supportGroupMember.findUnique({
      where: { groupId_userId: { groupId, userId } },
    });
    if (!membership) {
      throw new NotFoundException(`User ${userId} is not a member of group ${groupId}`);
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.supportGroupMember.delete({ where: { id: membership.id } });
      await this.auditService.record(
        {
          actorId: actor.actorId,
          entityType: "SupportGroup",
          entityId: groupId,
          action: "REMOVE_MEMBER",
          before: { userId },
          correlationId: actor.correlationId,
        },
        tx,
      );
    });
  }
}
