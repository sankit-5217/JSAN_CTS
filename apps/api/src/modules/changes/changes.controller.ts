import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { ChangesService } from "./changes.service";
import { ApproveChangeDto } from "./dto/approve-change.dto";
import { CreateChangeDto } from "./dto/create-change.dto";
import { QueryChangesDto } from "./dto/query-changes.dto";
import { UpdateChangeDto } from "./dto/update-change.dto";

// NOTE: RBAC (INFRASTRUCTURE_LEAD / DELIVERY_OPS_MANAGER approve; SITE_ENGINEER
// raise) + site scope are enforced here once the auth guard lands (spec §4).
// Approval and the "editable only before work starts" rule are backend state
// rules — the PATCH body is validated against the derived status server-side.
@ApiTags("changes")
@Controller("changes")
export class ChangesController {
  constructor(private readonly changesService: ChangesService) {}

  @Post()
  create(@Body() dto: CreateChangeDto) {
    return this.changesService.create(dto);
  }

  @Get()
  findAll(@Query() query: QueryChangesDto) {
    return this.changesService.list(query);
  }

  @Get("maintenance/active")
  @ApiOperation({
    summary: "Approved, in-window changes right now — the alert-suppression feed",
  })
  activeMaintenance() {
    return this.changesService.getActiveMaintenanceWindows();
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.changesService.getOne(id);
  }

  @Post(":id/approve")
  @ApiOperation({ summary: "Approve a change (idempotency: 409 if already approved)" })
  approve(@Param("id") id: string, @Body() dto: ApproveChangeDto) {
    return this.changesService.approve(id, dto);
  }

  @Patch(":id")
  @ApiOperation({ summary: "Edit plan/window (before work starts) or record the outcome / PIR" })
  update(@Param("id") id: string, @Body() dto: UpdateChangeDto) {
    return this.changesService.update(id, dto);
  }
}
