import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
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
import { CreateRackDto } from "./dto/create-rack.dto";

const CMDB_WRITE_ROLES = [
  UserRole.SUPER_ADMIN,
  UserRole.DELIVERY_OPS_MANAGER,
  UserRole.INFRASTRUCTURE_LEAD,
  UserRole.SITE_ENGINEER,
] as const;

@ApiTags("cmdb")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("racks")
export class RacksController {
  constructor(
    private readonly cmdbService: CmdbService,
    private readonly authzService: AuthzService,
  ) {}

  @Get()
  async findAll(@CurrentUser() user: AuthenticatedUser) {
    const accessibleSiteIds = await this.authzService.getAccessibleSiteIds(user);
    return this.cmdbService.listRacks(accessibleSiteIds);
  }

  @Get(":id")
  findOne(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.cmdbService.findRackScoped(id, user);
  }

  @Post()
  @Roles(...CMDB_WRITE_ROLES)
  create(
    @Body() dto: CreateRackDto,
    @CurrentUser() user: AuthenticatedUser,
    @CorrelationId() correlationId?: string,
  ) {
    return this.cmdbService.createRack(dto, { actorId: user.id, correlationId });
  }
}
