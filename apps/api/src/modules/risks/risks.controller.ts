import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { RisksService } from "./risks.service";
import { ChangeRiskStatusDto } from "./dto/change-risk-status.dto";
import { CreateRiskDto } from "./dto/create-risk.dto";
import { QueryRisksDto } from "./dto/query-risks.dto";
import { UpdateRiskDto } from "./dto/update-risk.dto";

// NOTE: RBAC (RISK_OWNER / DELIVERY_OPS_MANAGER raise & edit; only a manager
// may ACCEPT a HIGH/CRITICAL risk) + site scope are enforced here once the auth
// guard lands (spec §4). `score` is computed server-side and `status` moves
// only through the transition rules — never trust the client for either.
@ApiTags("risks")
@Controller("risks")
export class RisksController {
  constructor(private readonly risksService: RisksService) {}

  @Post()
  create(@Body() dto: CreateRiskDto) {
    return this.risksService.create(dto);
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
  @ApiOperation({
    summary: "Edit the register entry (re-computes score if likelihood/impact change)",
  })
  update(@Param("id") id: string, @Body() dto: UpdateRiskDto) {
    return this.risksService.update(id, dto);
  }

  @Post(":id/status")
  @ApiOperation({
    summary: "Move the risk through its lifecycle (OPEN/MITIGATING/ACCEPTED/CLOSED)",
  })
  changeStatus(@Param("id") id: string, @Body() dto: ChangeRiskStatusDto) {
    return this.risksService.changeStatus(id, dto);
  }
}
