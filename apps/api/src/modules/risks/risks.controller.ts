import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { UserRole } from "@prisma/client";
import { CorrelationId } from "../../common/decorators/correlation-id.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { AuthenticatedUser } from "../auth/types/jwt-payload.type";
import { RisksService } from "./risks.service";
import { ChangeRiskStatusDto } from "./dto/change-risk-status.dto";
import { CreateRiskDto } from "./dto/create-risk.dto";
import { QueryRisksDto } from "./dto/query-risks.dto";
import { UpdateRiskDto } from "./dto/update-risk.dto";

// `score` is computed server-side and `status` moves only through the transition
// rules — never trust the client for either (spec §4, §12).
// Risk `siteId` is nullable and the register is a cross-site governance view, so
// no SiteScopeGuard here; reads are visible to any authenticated user.
const RISK_WRITE_ROLES = [
  UserRole.SUPER_ADMIN,
  UserRole.DELIVERY_OPS_MANAGER,
  UserRole.INFRASTRUCTURE_LEAD,
] as const;

@ApiTags("risks")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("risks")
export class RisksController {
  constructor(private readonly risksService: RisksService) {}

  @Post()
  @Roles(...RISK_WRITE_ROLES)
  create(
    @Body() dto: CreateRiskDto,
    @CurrentUser() user: AuthenticatedUser,
    @CorrelationId() correlationId?: string,
  ) {
    return this.risksService.create(dto, { actorId: user.id, correlationId });
  }

  @Get()
  findAll(@Query() query: QueryRisksDto) {
    return this.risksService.list(query);
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.risksService.getOne(id);
  }

  @Patch(":id")
  @Roles(...RISK_WRITE_ROLES)
  @ApiOperation({
    summary: "Edit the register entry (re-computes score if likelihood/impact change)",
  })
  update(
    @Param("id") id: string,
    @Body() dto: UpdateRiskDto,
    @CurrentUser() user: AuthenticatedUser,
    @CorrelationId() correlationId?: string,
  ) {
    return this.risksService.update(id, dto, { actorId: user.id, correlationId });
  }

  @Post(":id/status")
  @Roles(...RISK_WRITE_ROLES)
  @ApiOperation({
    summary: "Move the risk through its lifecycle (OPEN/MITIGATING/ACCEPTED/CLOSED)",
  })
  changeStatus(
    @Param("id") id: string,
    @Body() dto: ChangeRiskStatusDto,
    @CurrentUser() user: AuthenticatedUser,
    @CorrelationId() correlationId?: string,
  ) {
    return this.risksService.changeStatus(id, dto, { actorId: user.id, correlationId });
  }
}
