import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../common/prisma/prisma.service";
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
  constructor(private readonly prisma: PrismaService) {}

  /**
   * `accessibleSiteIds`: `null` (or omitted) = unrestricted (caller has an
   * "all sites" role, see AuthzService); an array = filter to exactly
   * those sites. List endpoints filter rather than 403 — a scoped user
   * asking for "all sites" should just see their sites, not get rejected.
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

  create(dto: CreateSiteDto) {
    return this.prisma.site.create({
      data: {
        code: dto.code,
        name: dto.name,
        timezone: dto.timezone,
        is247: dto.is247 ?? false,
      },
    });
  }

  // --- Site contacts -------------------------------------------------

  async listContacts(siteId: string) {
    await this.findOne(siteId); // 404s if the site doesn't exist
    return this.prisma.siteContact.findMany({ where: { siteId }, orderBy: { name: "asc" } });
  }

  async createContact(siteId: string, dto: CreateSiteContactDto) {
    await this.findOne(siteId);
    return this.prisma.siteContact.create({
      data: {
        siteId,
        name: dto.name,
        role: dto.role,
        email: dto.email,
        phone: dto.phone,
        isOnCall: dto.isOnCall ?? false,
      },
    });
  }

  // --- Support calendars -----------------------------------------------

  async listSupportCalendars(siteId: string) {
    await this.findOne(siteId);
    return this.prisma.supportCalendar.findMany({ where: { siteId }, orderBy: { name: "asc" } });
  }

  async createSupportCalendar(siteId: string, dto: CreateSupportCalendarDto) {
    await this.findOne(siteId);
    return this.prisma.supportCalendar.create({
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
  }

  // --- Support groups (not site-scoped) ---------------------------------

  listSupportGroups() {
    return this.prisma.supportGroup.findMany({ orderBy: { name: "asc" } });
  }

  createSupportGroup(dto: CreateSupportGroupDto) {
    return this.prisma.supportGroup.create({ data: { name: dto.name } });
  }
}
