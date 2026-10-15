import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { UserRole } from "@prisma/client";
import { CorrelationId } from "../../common/decorators/correlation-id.decorator";
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
import { ListSitesQueryDto } from "./dto/list-sites-query.dto";
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
  async findAll(@Query() query: ListSitesQueryDto, @CurrentUser() user: AuthenticatedUser) {
    const accessibleSiteIds = await this.authzService.getAccessibleSiteIds(user);
    // Only the Super Admin's Sites page lists archived ("deleted") sites.
    const includeArchived = query.includeArchived === true && user.role === UserRole.SUPER_ADMIN;
    return this.sitesService.findAll({ ...query, includeArchived }, accessibleSiteIds);
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
  create(
    @Body() dto: CreateSiteDto,
    @CurrentUser() user: AuthenticatedUser,
    @CorrelationId() correlationId?: string,
  ) {
    return this.sitesService.create(dto, { actorId: user.id, correlationId });
  }

  @Post(":id/archive")
  @HttpCode(200)
  @Roles(UserRole.SUPER_ADMIN)
  @ApiOperation({
    summary:
      "Delete a site: archives it (hidden, no new work, history kept, restorable); refused while it has open tickets",
  })
  archive(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @CorrelationId() correlationId?: string,
  ) {
    return this.sitesService.archive(id, { actorId: user.id, correlationId });
  }

  @Post(":id/restore")
  @HttpCode(200)
  @Roles(UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: "Restore an archived (deleted) site" })
  restore(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @CorrelationId() correlationId?: string,
  ) {
    return this.sitesService.restore(id, { actorId: user.id, correlationId });
  }

  @Get(":siteId/contacts")
  listContacts(@Param("siteId") siteId: string) {
    return this.sitesService.listContacts(siteId);
  }

  @Post(":siteId/contacts")
  @Roles(...SITE_MASTER_WRITE_ROLES)
  createContact(
    @Param("siteId") siteId: string,
    @Body() dto: CreateSiteContactDto,
    @CurrentUser() user: AuthenticatedUser,
    @CorrelationId() correlationId?: string,
  ) {
    return this.sitesService.createContact(siteId, dto, { actorId: user.id, correlationId });
  }

  @Get(":siteId/support-calendars")
  listSupportCalendars(@Param("siteId") siteId: string) {
    return this.sitesService.listSupportCalendars(siteId);
  }

  @Post(":siteId/support-calendars")
  @Roles(...SITE_MASTER_WRITE_ROLES)
  createSupportCalendar(
    @Param("siteId") siteId: string,
    @Body() dto: CreateSupportCalendarDto,
    @CurrentUser() user: AuthenticatedUser,
    @CorrelationId() correlationId?: string,
  ) {
    return this.sitesService.createSupportCalendar(siteId, dto, {
      actorId: user.id,
      correlationId,
    });
  }
}
