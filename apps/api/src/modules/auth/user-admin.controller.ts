import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { UserRole } from "@prisma/client";
import { CorrelationId } from "../../common/decorators/correlation-id.decorator";
import { CurrentUser } from "./decorators/current-user.decorator";
import { Roles } from "./decorators/roles.decorator";
import { ApiTokensService } from "./api-tokens.service";
import {
  CreateAdminUserDto,
  CreateApiTokenDto,
  ListAdminUsersQueryDto,
  SetUserSitesDto,
  UpdateAdminUserDto,
} from "./dto/admin-user.dto";
import { JwtAuthGuard } from "./guards/jwt-auth.guard";
import { RolesGuard } from "./guards/roles.guard";
import { AuthenticatedUser } from "./types/jwt-payload.type";
import { UserAdminService } from "./user-admin.service";

/**
 * User administration — Super Admin only (spec §4: admin changes). Kept
 * apart from UsersController, whose reads back every assignment picker and
 * deliberately expose only active users' names.
 */
@ApiTags("users")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
@Controller("admin/users")
export class UserAdminController {
  constructor(
    private readonly userAdmin: UserAdminService,
    private readonly apiTokens: ApiTokensService,
  ) {}

  @Get()
  @ApiOperation({ summary: "All users, including inactive, with role and site grants" })
  list(@Query() query: ListAdminUsersQueryDto) {
    return this.userAdmin.list(query);
  }

  @Get(":id")
  @ApiOperation({ summary: "One user with role and site grants" })
  findOne(@Param("id", ParseUUIDPipe) id: string) {
    return this.userAdmin.findOne(id);
  }

  @Post()
  @ApiOperation({ summary: "Add a user and email them an invite to choose a password" })
  create(
    @Body() dto: CreateAdminUserDto,
    @CurrentUser() user: AuthenticatedUser,
    @CorrelationId() correlationId?: string,
  ) {
    return this.userAdmin.create(dto, { actorId: user.id, correlationId });
  }

  @Patch(":id")
  @ApiOperation({ summary: "Edit email, name or role" })
  update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateAdminUserDto,
    @CurrentUser() user: AuthenticatedUser,
    @CorrelationId() correlationId?: string,
  ) {
    return this.userAdmin.update(id, dto, { actorId: user.id, correlationId });
  }

  @Put(":id/sites")
  @ApiOperation({ summary: "Replace the user's site access grants" })
  setSites(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: SetUserSitesDto,
    @CurrentUser() user: AuthenticatedUser,
    @CorrelationId() correlationId?: string,
  ) {
    return this.userAdmin.setSites(id, dto, { actorId: user.id, correlationId });
  }

  @Post(":id/deactivate")
  @HttpCode(200)
  @ApiOperation({ summary: "Disable sign-in; refused while the user owns open incidents" })
  deactivate(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @CorrelationId() correlationId?: string,
  ) {
    return this.userAdmin.deactivate(id, { actorId: user.id, correlationId });
  }

  @Post(":id/reactivate")
  @HttpCode(200)
  @ApiOperation({ summary: "Re-enable sign-in" })
  reactivate(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @CorrelationId() correlationId?: string,
  ) {
    return this.userAdmin.reactivate(id, { actorId: user.id, correlationId });
  }

  @Post(":id/sign-in-link")
  @HttpCode(200)
  @ApiOperation({
    summary:
      "Email a set-password link (invite, or reset if they have a password); also returned for sharing",
  })
  sendSignInLink(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @CorrelationId() correlationId?: string,
  ) {
    return this.userAdmin.sendSignInLink(id, { actorId: user.id, correlationId });
  }

  @Get(":id/api-tokens")
  @ApiOperation({ summary: "The user's machine API tokens (never the token values)" })
  listApiTokens(@Param("id", ParseUUIDPipe) id: string) {
    return this.apiTokens.list(id);
  }

  @Post(":id/api-tokens")
  @ApiOperation({ summary: "Create a machine API token — the value is returned once, only here" })
  createApiToken(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: CreateApiTokenDto,
    @CurrentUser() user: AuthenticatedUser,
    @CorrelationId() correlationId?: string,
  ) {
    return this.apiTokens.create(id, dto, { actorId: user.id, correlationId });
  }

  @Post(":id/api-tokens/:tokenId/revoke")
  @HttpCode(200)
  @ApiOperation({ summary: "Revoke a machine API token immediately" })
  revokeApiToken(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("tokenId", ParseUUIDPipe) tokenId: string,
    @CurrentUser() user: AuthenticatedUser,
    @CorrelationId() correlationId?: string,
  ) {
    return this.apiTokens.revoke(id, tokenId, { actorId: user.id, correlationId });
  }
}
