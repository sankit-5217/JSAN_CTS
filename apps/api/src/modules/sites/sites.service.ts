import { Injectable, NotFoundException } from "@nestjs/common";
import { ActorContext } from "../../common/types/actor-context.type";
import { PrismaService } from "../../common/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { CreateSiteContactDto } from "./dto/create-site-contact.dto";
import { CreateSiteDto } from "./dto/create-site.dto";
import { CreateSupportCalendarDto } from "./dto/create-support-calendar.dto";
import { CreateSupportGroupDto } from "./dto/create-support-group.dto";

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
   *
   * TODO: no pagination yet, unlike CmdbService's list endpoint (spec
   * §14.1 requires it on every list endpoint). Low risk today — the
   * number of sites in a deployment is small — but retrofit this before
   * it isn't.
   */
  findAll(accessibleSiteIds?: string[] | null) {
    return this.prisma.site.findMany({
      where: accessibleSiteIds ? { id: { in: accessibleSiteIds } } : undefined,
      orderBy: { code: "asc" },
    });
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
}
