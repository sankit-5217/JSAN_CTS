import { Body, Controller, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CorrelationId } from "../../common/decorators/correlation-id.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { AuthenticatedUser } from "../auth/types/jwt-payload.type";
import { INCIDENT_WRITE_ROLES } from "../incidents/incidents.controller";
import { CorrectWorklogDto } from "./dto/correct-worklog.dto";
import { CreateWorklogDto } from "./dto/create-worklog.dto";
import { WorklogsService } from "./worklogs.service";

// Nested under the parent incident, matching spec §14.1's
// `POST /api/v1/incidents/{id}/worklogs`.
@ApiTags("worklogs")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("incidents/:incidentId/worklogs")
export class IncidentWorklogsController {
  constructor(private readonly worklogsService: WorklogsService) {}

  @Get()
  listByIncident(@Param("incidentId") incidentId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.worklogsService.listByIncident(incidentId, user);
  }

  @Post()
  @Roles(...INCIDENT_WRITE_ROLES)
  create(
    @Param("incidentId") incidentId: string,
    @Body() dto: CreateWorklogDto,
    @CurrentUser() user: AuthenticatedUser,
    @CorrelationId() correlationId?: string,
  ) {
    return this.worklogsService.create(incidentId, dto, { actorId: user.id, correlationId }, user);
  }
}

// Flat — a worklog's own id is already unique, no need for the incident id
// in the path (same shape as CMDB's flat PATCH /cis/:id).
@ApiTags("worklogs")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("worklogs")
export class WorklogsController {
  constructor(private readonly worklogsService: WorklogsService) {}

  @Patch(":id")
  @Roles(...INCIDENT_WRITE_ROLES)
  correct(
    @Param("id") id: string,
    @Body() dto: CorrectWorklogDto,
    @CurrentUser() user: AuthenticatedUser,
    @CorrelationId() correlationId?: string,
  ) {
    return this.worklogsService.correct(id, dto, { actorId: user.id, correlationId }, user);
  }
}
