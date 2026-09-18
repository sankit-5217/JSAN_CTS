import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { UserRole } from "@prisma/client";
import { CorrelationId } from "../../common/decorators/correlation-id.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import { AuthzService } from "../auth/authz.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { AuthenticatedUser } from "../auth/types/jwt-payload.type";
import { CreateShiftDto } from "./dto/create-shift.dto";
import { QueryShiftsDto } from "./dto/query-shifts.dto";
import { UpdateShiftDto } from "./dto/update-shift.dto";
import { ShiftsService } from "./shifts.service";

// Scheduling engineers is a delivery/ops management call, same tier as SLA
// policy write access (sla.controller.ts's SLA_POLICY_WRITE_ROLES) — plus
// INFRASTRUCTURE_LEAD, who directly leads the engineering roster.
const SHIFT_WRITE_ROLES = [
  UserRole.SUPER_ADMIN,
  UserRole.INFRASTRUCTURE_LEAD,
  UserRole.DELIVERY_OPS_MANAGER,
] as const;

// Internal staffing/on-call visibility — every staff role except the
// customer-facing CLIENT_MANAGER_VIEWER (spec: management data never
// exposed to the client portal).
const SHIFT_READ_ROLES = [
  UserRole.SUPER_ADMIN,
  UserRole.SERVICE_DESK_NOC,
  UserRole.SITE_ENGINEER,
  UserRole.INFRASTRUCTURE_LEAD,
  UserRole.VENDOR_COORDINATOR,
  UserRole.DELIVERY_OPS_MANAGER,
  UserRole.AUDITOR_READ_ONLY,
] as const;

@ApiTags("shifts")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("shifts")
export class ShiftsController {
  constructor(
    private readonly shiftsService: ShiftsService,
    private readonly authzService: AuthzService,
  ) {}

  @Get()
  @Roles(...SHIFT_READ_ROLES)
  @ApiOperation({ summary: "List engineer shift schedules, optionally filtered by site/engineer" })
  async findAll(@Query() query: QueryShiftsDto, @CurrentUser() user: AuthenticatedUser) {
    const accessibleSiteIds = await this.authzService.getAccessibleSiteIds(user);
    return this.shiftsService.findAll(query, accessibleSiteIds);
  }

  @Get("live")
  @Roles(...SHIFT_READ_ROLES)
  @ApiOperation({ summary: "Who's on a working shift or on-call right now, per the schedule" })
  async live(@Query() query: QueryShiftsDto, @CurrentUser() user: AuthenticatedUser) {
    const accessibleSiteIds = await this.authzService.getAccessibleSiteIds(user);
    return this.shiftsService.getLiveRoster(query, accessibleSiteIds);
  }

  @Post()
  @Roles(...SHIFT_WRITE_ROLES)
  @ApiOperation({ summary: "Create a recurring weekly shift for an engineer at a site" })
  create(
    @Body() dto: CreateShiftDto,
    @CurrentUser() user: AuthenticatedUser,
    @CorrelationId() correlationId?: string,
  ) {
    return this.shiftsService.create(dto, { actorId: user.id, correlationId });
  }

  @Patch(":id")
  @Roles(...SHIFT_WRITE_ROLES)
  @ApiOperation({ summary: "Update or deactivate a shift" })
  update(
    @Param("id") id: string,
    @Body() dto: UpdateShiftDto,
    @CurrentUser() user: AuthenticatedUser,
    @CorrelationId() correlationId?: string,
  ) {
    return this.shiftsService.update(id, dto, { actorId: user.id, correlationId });
  }
}
