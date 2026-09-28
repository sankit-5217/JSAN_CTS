import { Controller, ForbiddenException, Get, Param, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { UserRole } from "@prisma/client";
import { AuthzService } from "./authz.service";
import { CurrentUser } from "./decorators/current-user.decorator";
import { Roles } from "./decorators/roles.decorator";
import { ListUsersQueryDto } from "./dto/list-users-query.dto";
import { JwtAuthGuard } from "./guards/jwt-auth.guard";
import { RolesGuard } from "./guards/roles.guard";
import { AuthenticatedUser } from "./types/jwt-payload.type";
import { UsersService } from "./users.service";

// Every internal staff role — everyone who might need to look up a
// colleague to assign/route something to. The one role intentionally left
// out is CTS_MANAGER_VIEWER: a customer has no reason to see staff names
// tied to internal user ids.
export const STAFF_ROLES = [
  UserRole.SUPER_ADMIN,
  UserRole.SERVICE_DESK_NOC,
  UserRole.SITE_ENGINEER,
  UserRole.INFRASTRUCTURE_LEAD,
  UserRole.VENDOR_COORDINATOR,
  UserRole.DELIVERY_OPS_MANAGER,
  UserRole.AUDITOR_READ_ONLY,
] as const;

@ApiTags("users")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("users")
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly authzService: AuthzService,
  ) {}

  @Get()
  @Roles(...STAFF_ROLES)
  @ApiOperation({ summary: "Look up staff by role/site — backs assignment pickers" })
  async findAll(@Query() query: ListUsersQueryDto, @CurrentUser() user: AuthenticatedUser) {
    if (query.siteId && !(await this.authzService.canAccessSite(user, query.siteId))) {
      throw new ForbiddenException(`No access to site ${query.siteId}`);
    }
    return this.usersService.findAll(query);
  }

  @Get(":id")
  @Roles(...STAFF_ROLES)
  @ApiOperation({ summary: "Resolve a single user id — used to seed a picker's initial value" })
  findOne(@Param("id") id: string) {
    return this.usersService.findOne(id);
  }
}
