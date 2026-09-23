import { Controller, Get, Param, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { AuthenticatedUser } from "../auth/types/jwt-payload.type";
import { INCIDENT_ROUTING_ROLES } from "../incidents/incident-transitions";
import { RoutingService } from "./routing.service";

// Mounted under /incidents so the URL reads as a property of the incident,
// but owned here — IncidentsController's `:id` route only matches a single
// segment, so there's no overlap.
@ApiTags("routing")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("incidents")
export class RoutingController {
  constructor(private readonly routingService: RoutingService) {}

  // Same roles as reassigning ownership — suggestions are only useful to
  // whoever is allowed to act on them.
  @Get(":id/routing-suggestions")
  @Roles(...INCIDENT_ROUTING_ROLES)
  @ApiOperation({
    summary:
      "Engineers on shift at the incident's site who hold every skill its category requires, least-loaded first",
  })
  suggest(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.routingService.suggestForIncident(id, user);
  }
}
