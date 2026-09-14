import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { UserRole } from "@prisma/client";
import { CorrelationId } from "../../common/decorators/correlation-id.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { AuthenticatedUser } from "../auth/types/jwt-payload.type";
import { AddSupportGroupMemberDto } from "./dto/add-support-group-member.dto";
import { CreateSupportGroupDto } from "./dto/create-support-group.dto";
import { SitesService } from "./sites.service";

// Support groups aren't site-scoped (an ownership/assignment group can
// span sites), so no SiteScopeGuard here — just authenticated + role.
// Same write tier as group creation for membership changes — roster is
// governance, not something any staff member should self-edit.
const SUPPORT_GROUP_WRITE_ROLES = [UserRole.SUPER_ADMIN, UserRole.DELIVERY_OPS_MANAGER] as const;

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
  @Roles(...SUPPORT_GROUP_WRITE_ROLES)
  create(
    @Body() dto: CreateSupportGroupDto,
    @CurrentUser() user: AuthenticatedUser,
    @CorrelationId() correlationId?: string,
  ) {
    return this.sitesService.createSupportGroup(dto, { actorId: user.id, correlationId });
  }

  @Delete(":id")
  @Roles(...SUPPORT_GROUP_WRITE_ROLES)
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param("id") id: string,
    @CurrentUser() user: AuthenticatedUser,
    @CorrelationId() correlationId?: string,
  ) {
    await this.sitesService.deleteSupportGroup(id, { actorId: user.id, correlationId });
  }

  @Get(":id/members")
  listMembers(@Param("id") id: string) {
    return this.sitesService.listGroupMembers(id);
  }

  @Post(":id/members")
  @Roles(...SUPPORT_GROUP_WRITE_ROLES)
  addMember(
    @Param("id") id: string,
    @Body() dto: AddSupportGroupMemberDto,
    @CurrentUser() user: AuthenticatedUser,
    @CorrelationId() correlationId?: string,
  ) {
    return this.sitesService.addGroupMember(id, dto, { actorId: user.id, correlationId });
  }

  @Delete(":id/members/:userId")
  @Roles(...SUPPORT_GROUP_WRITE_ROLES)
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeMember(
    @Param("id") id: string,
    @Param("userId") userId: string,
    @CurrentUser() user: AuthenticatedUser,
    @CorrelationId() correlationId?: string,
  ) {
    await this.sitesService.removeGroupMember(id, userId, { actorId: user.id, correlationId });
  }
}
