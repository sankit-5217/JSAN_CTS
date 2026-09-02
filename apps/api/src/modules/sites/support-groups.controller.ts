import { Body, Controller, Get, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { UserRole } from "@prisma/client";
import { Roles } from "../auth/decorators/roles.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { CreateSupportGroupDto } from "./dto/create-support-group.dto";
import { SitesService } from "./sites.service";

// Support groups aren't site-scoped (an ownership/assignment group can
// span sites), so no SiteScopeGuard here — just authenticated + role.
@ApiTags("support-groups")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("support-groups")
export class SupportGroupsController {
  constructor(private readonly sitesService: SitesService) {}

  @Get()
  findAll() {
    return this.sitesService.listSupportGroups();
  }

  @Post()
  @Roles(UserRole.SUPER_ADMIN, UserRole.DELIVERY_OPS_MANAGER)
  create(@Body() dto: CreateSupportGroupDto) {
    return this.sitesService.createSupportGroup(dto);
  }
}
