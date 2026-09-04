import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { UserRole } from "@prisma/client";
import { CorrelationId } from "../../common/decorators/correlation-id.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { AuthenticatedUser } from "../auth/types/jwt-payload.type";
import { ChangesService } from "./changes.service";
import { ApproveChangeDto } from "./dto/approve-change.dto";
import { CreateChangeDto } from "./dto/create-change.dto";
import { QueryChangesDto } from "./dto/query-changes.dto";
import { UpdateChangeDto } from "./dto/update-change.dto";

// Approval and the "editable only before work starts" rule are backend state
// rules — the PATCH body is validated against the derived status server-side
// (spec §4, §12). The Change schema has no site link yet, so no SiteScopeGuard.
const CHANGE_RAISE_ROLES = [
  UserRole.SUPER_ADMIN,
  UserRole.DELIVERY_OPS_MANAGER,
  UserRole.INFRASTRUCTURE_LEAD,
  UserRole.SITE_ENGINEER,
] as const;
const CHANGE_APPROVE_ROLES = [
  UserRole.SUPER_ADMIN,
  UserRole.DELIVERY_OPS_MANAGER,
  UserRole.INFRASTRUCTURE_LEAD,
] as const;

@ApiTags("changes")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("changes")
export class ChangesController {
  constructor(private readonly changesService: ChangesService) {}

  @Post()
  @Roles(...CHANGE_RAISE_ROLES)
  create(
    @Body() dto: CreateChangeDto,
    @CurrentUser() user: AuthenticatedUser,
    @CorrelationId() correlationId?: string,
  ) {
    return this.changesService.create(dto, { actorId: user.id, correlationId });
  }

  @Get()
  findAll(@Query() query: QueryChangesDto) {
    return this.changesService.list(query);
  }

  @Get("maintenance/active")
  @ApiOperation({
    summary: "Approved, in-window changes right now — the alert-suppression feed",
    description: "Pass ?ciId to get only windows affecting that CI (or site-wide windows).",
  })
  activeMaintenance(@Query("ciId") ciId?: string) {
    return this.changesService.getActiveMaintenanceWindows(new Date(), ciId);
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.changesService.getOne(id);
  }

  @Post(":id/approve")
  @Roles(...CHANGE_APPROVE_ROLES)
  @ApiOperation({ summary: "Approve a change (idempotency: 409 if already approved)" })
  approve(
    @Param("id") id: string,
    @Body() dto: ApproveChangeDto,
    @CurrentUser() user: AuthenticatedUser,
    @CorrelationId() correlationId?: string,
  ) {
    return this.changesService.approve(id, dto, { actorId: user.id, correlationId });
  }

  @Patch(":id")
  @Roles(...CHANGE_RAISE_ROLES)
  @ApiOperation({ summary: "Edit plan/window (before work starts) or record the outcome / PIR" })
  update(
    @Param("id") id: string,
    @Body() dto: UpdateChangeDto,
    @CurrentUser() user: AuthenticatedUser,
    @CorrelationId() correlationId?: string,
  ) {
    return this.changesService.update(id, dto, { actorId: user.id, correlationId });
  }
}
