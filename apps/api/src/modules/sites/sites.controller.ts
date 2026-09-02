import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { UserRole } from "@prisma/client";
import { AuthzService } from "../auth/authz.service";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { SiteScopeGuard } from "../auth/guards/site-scope.guard";
import { AuthenticatedUser } from "../auth/types/jwt-payload.type";
import { CreateSiteContactDto } from "./dto/create-site-contact.dto";
import { CreateSiteDto } from "./dto/create-site.dto";
import { CreateSupportCalendarDto } from "./dto/create-support-calendar.dto";
import { SitesService } from "./sites.service";

// RBAC + site scope enforced server-side on every route, per the spec's
// "RBAC rule" (§4) — the frontend must never be the only thing hiding a
// button. SiteScopeGuard covers :id/:siteId; JwtAuthGuard/RolesGuard cover
// authentication and per-route role checks.
//
// Write roles for contacts/calendars: SUPER_ADMIN, DELIVERY_OPS_MANAGER,
// INFRASTRUCTURE_LEAD — matches spec §4's "Infrastructure Lead: ownership,
// escalation, technical review" plus the two platform-admin roles. Site
// creation itself stays SUPER_ADMIN-only (see the note on `create`).
const SITE_MASTER_WRITE_ROLES = [
  UserRole.SUPER_ADMIN,
  UserRole.DELIVERY_OPS_MANAGER,
  UserRole.INFRASTRUCTURE_LEAD,
] as const;

@ApiTags("sites")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, SiteScopeGuard)
@Controller("sites")
export class SitesController {
  constructor(
    private readonly sitesService: SitesService,
    private readonly authzService: AuthzService,
  ) {}

  @Get()
  async findAll(@CurrentUser() user: AuthenticatedUser) {
    const accessibleSiteIds = await this.authzService.getAccessibleSiteIds(user);
    return this.sitesService.findAll(accessibleSiteIds);
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    // SiteScopeGuard already rejected this above if `user` can't see `id`.
    return this.sitesService.findOne(id);
  }

  // Site master data is foundational platform config (spec §4: Super
  // Admin owns "platform configuration"). Widen this if a real
  // requirement needs another role to create sites.
  @Post()
  @Roles(UserRole.SUPER_ADMIN)
  create(@Body() dto: CreateSiteDto) {
    return this.sitesService.create(dto);
  }

  @Get(":siteId/contacts")
  listContacts(@Param("siteId") siteId: string) {
    return this.sitesService.listContacts(siteId);
  }

  @Post(":siteId/contacts")
  @Roles(...SITE_MASTER_WRITE_ROLES)
  createContact(@Param("siteId") siteId: string, @Body() dto: CreateSiteContactDto) {
    return this.sitesService.createContact(siteId, dto);
  }

  @Get(":siteId/support-calendars")
  listSupportCalendars(@Param("siteId") siteId: string) {
    return this.sitesService.listSupportCalendars(siteId);
  }

  @Post(":siteId/support-calendars")
  @Roles(...SITE_MASTER_WRITE_ROLES)
  createSupportCalendar(@Param("siteId") siteId: string, @Body() dto: CreateSupportCalendarDto) {
    return this.sitesService.createSupportCalendar(siteId, dto);
  }
}
