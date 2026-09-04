import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { CorrelationId } from "../../common/decorators/correlation-id.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { AuthenticatedUser } from "../auth/types/jwt-payload.type";
import { BcpService } from "./bcp.service";
import { CreateBcpPlanDto } from "./dto/create-bcp-plan.dto";
import { QueryBcpPlansDto } from "./dto/query-bcp-plans.dto";
import { RecordBcpTestDto } from "./dto/record-bcp-test.dto";
import { UpdateBcpPlanDto } from "./dto/update-bcp-plan.dto";
import { RISK_WRITE_ROLES } from "./risks.controller";

// BCP plans are cross-site governance records (spec §10.15) — same write tier
// as the risk register, no SiteScopeGuard; reads open to any authenticated user.
@ApiTags("risks")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("bcp-plans")
export class BcpController {
  constructor(private readonly bcp: BcpService) {}

  @Post()
  @Roles(...RISK_WRITE_ROLES)
  @ApiOperation({ summary: "Create a BCP plan for a site or a named service (spec §10.15)" })
  create(
    @Body() dto: CreateBcpPlanDto,
    @CurrentUser() user: AuthenticatedUser,
    @CorrelationId() correlationId?: string,
  ) {
    return this.bcp.create(dto, { actorId: user.id, correlationId });
  }

  @Get()
  @ApiOperation({ summary: "List BCP plans; ?view=due for plans overdue a test" })
  findAll(@Query() query: QueryBcpPlansDto) {
    return this.bcp.list(query);
  }

  @Get(":id")
  @ApiOperation({ summary: "Get a BCP plan with its derived test readiness" })
  findOne(@Param("id") id: string) {
    return this.bcp.getOne(id);
  }

  @Patch(":id")
  @Roles(...RISK_WRITE_ROLES)
  @ApiOperation({ summary: "Edit a BCP plan (RTO/RPO, strategy, alternate site, retire)" })
  update(
    @Param("id") id: string,
    @Body() dto: UpdateBcpPlanDto,
    @CurrentUser() user: AuthenticatedUser,
    @CorrelationId() correlationId?: string,
  ) {
    return this.bcp.update(id, dto, { actorId: user.id, correlationId });
  }

  @Post(":id/tests")
  @Roles(...RISK_WRITE_ROLES)
  @ApiOperation({ summary: "Log a BCP test — stamps last tested and the next due date" })
  recordTest(
    @Param("id") id: string,
    @Body() dto: RecordBcpTestDto,
    @CurrentUser() user: AuthenticatedUser,
    @CorrelationId() correlationId?: string,
  ) {
    return this.bcp.recordTest(id, dto, { actorId: user.id, correlationId });
  }
}
