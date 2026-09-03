import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { UserRole } from "@prisma/client";
import { CorrelationId } from "../../common/decorators/correlation-id.decorator";
import { AuthzService } from "../auth/authz.service";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { AuthenticatedUser } from "../auth/types/jwt-payload.type";
import { CmdbService } from "./cmdb.service";
import { CreateCiDto } from "./dto/create-ci.dto";
import { ListCisQueryDto } from "./dto/list-cis-query.dto";
import { UpdateCiDto } from "./dto/update-ci.dto";

// Flat routes (not nested under /sites/:siteId), matching the spec's own
// API table in §14.1 (`/api/v1/cis`). Site scope is enforced explicitly in
// CmdbService (see its class comment) rather than via SiteScopeGuard,
// since :id here is a CI's own id, not a site id.
//
// Write roles: SUPER_ADMIN, DELIVERY_OPS_MANAGER, INFRASTRUCTURE_LEAD, and
// SITE_ENGINEER — wider than Sites' write policy. Spec §4 gives Site
// Engineer "limited admin" on assigned assets, and they're the ones doing
// on-site/remote inventory in practice.
const CMDB_WRITE_ROLES = [
  UserRole.SUPER_ADMIN,
  UserRole.DELIVERY_OPS_MANAGER,
  UserRole.INFRASTRUCTURE_LEAD,
  UserRole.SITE_ENGINEER,
] as const;

@ApiTags("cmdb")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("cis")
export class CisController {
  constructor(
    private readonly cmdbService: CmdbService,
    private readonly authzService: AuthzService,
  ) {}

  @Get()
  async findAll(@Query() query: ListCisQueryDto, @CurrentUser() user: AuthenticatedUser) {
    const accessibleSiteIds = await this.authzService.getAccessibleSiteIds(user);
    return this.cmdbService.findAll(query, accessibleSiteIds);
  }

  @Get(":id")
  findOne(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.cmdbService.findOneScoped(id, user);
  }

  @Post()
  @Roles(...CMDB_WRITE_ROLES)
  create(
    @Body() dto: CreateCiDto,
    @CurrentUser() user: AuthenticatedUser,
    @CorrelationId() correlationId?: string,
  ) {
    return this.cmdbService.create(dto, { actorId: user.id, correlationId });
  }

  @Patch(":id")
  @Roles(...CMDB_WRITE_ROLES)
  update(
    @Param("id") id: string,
    @Body() dto: UpdateCiDto,
    @CurrentUser() user: AuthenticatedUser,
    @CorrelationId() correlationId?: string,
  ) {
    return this.cmdbService.update(id, dto, user, { actorId: user.id, correlationId });
  }
}
