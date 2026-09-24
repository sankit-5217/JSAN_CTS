import { Body, Controller, Get, HttpCode, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { UserRole } from "@prisma/client";
import { CorrelationId } from "../../common/decorators/correlation-id.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { AuthenticatedUser } from "../auth/types/jwt-payload.type";
import { INCIDENT_ROUTING_ROLES } from "../incidents/incident-transitions";
import { DeclineRoutingOfferDto } from "./dto/decline-routing-offer.dto";
import { UpdateRoutingPolicyDto } from "./dto/update-routing-policy.dto";
import { RoutingOffersService } from "./routing-offers.service";
import { RoutingService } from "./routing.service";

// Turning auto-assign on for a site is a governance call — same write tier
// as the skills/shift configuration it acts on.
const ROUTING_POLICY_WRITE_ROLES = [
  UserRole.SUPER_ADMIN,
  UserRole.INFRASTRUCTURE_LEAD,
  UserRole.DELIVERY_OPS_MANAGER,
] as const;

// Internal configuration visibility — every staff role except the
// customer-facing CLIENT_MANAGER_VIEWER (same set as shifts' read roles).
const ROUTING_POLICY_READ_ROLES = [
  UserRole.SUPER_ADMIN,
  UserRole.SERVICE_DESK_NOC,
  UserRole.SITE_ENGINEER,
  UserRole.INFRASTRUCTURE_LEAD,
  UserRole.VENDOR_COORDINATOR,
  UserRole.DELIVERY_OPS_MANAGER,
  UserRole.AUDITOR_READ_ONLY,
] as const;

// Offers only ever go to engineers on shift, who can hold any staff role
// that works shifts. The service then checks the caller is the engineer the
// open offer was made to, so this list is only a coarse outer gate.
const OFFER_RESPONDER_ROLES = [
  UserRole.SUPER_ADMIN,
  UserRole.SERVICE_DESK_NOC,
  UserRole.SITE_ENGINEER,
  UserRole.INFRASTRUCTURE_LEAD,
  UserRole.VENDOR_COORDINATOR,
  UserRole.DELIVERY_OPS_MANAGER,
] as const;

// Mounted under /incidents so the URL reads as a property of the incident,
// but owned here — IncidentsController's `:id` route only matches a single
// segment, so there's no overlap.
@ApiTags("routing")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("incidents")
export class RoutingController {
  constructor(
    private readonly routingService: RoutingService,
    private readonly offersService: RoutingOffersService,
  ) {}

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

  @Get(":id/routing-offers")
  @Roles(...ROUTING_POLICY_READ_ROLES)
  @ApiOperation({ summary: "The incident's open routing offer, if any, and every past offer" })
  listOffers(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.offersService.listForIncident(id, user);
  }

  @Post(":id/routing-offers/accept")
  @HttpCode(200)
  @Roles(...OFFER_RESPONDER_ROLES)
  @ApiOperation({ summary: "Accept the open offer made to me; the incident is assigned to me" })
  acceptOffer(
    @Param("id") id: string,
    @CurrentUser() user: AuthenticatedUser,
    @CorrelationId() correlationId?: string,
  ) {
    return this.offersService.accept(id, user, { actorId: user.id, correlationId });
  }

  @Post(":id/routing-offers/decline")
  @HttpCode(200)
  @Roles(...OFFER_RESPONDER_ROLES)
  @ApiOperation({ summary: "Decline the open offer made to me; it moves to the next engineer" })
  declineOffer(
    @Param("id") id: string,
    @Body() dto: DeclineRoutingOfferDto,
    @CurrentUser() user: AuthenticatedUser,
    @CorrelationId() correlationId?: string,
  ) {
    return this.offersService.decline(id, user, dto.reason, { actorId: user.id, correlationId });
  }
}

@ApiTags("routing")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("routing/policies")
export class RoutingPoliciesController {
  constructor(private readonly routingService: RoutingService) {}

  @Get(":siteId")
  @Roles(...ROUTING_POLICY_READ_ROLES)
  @ApiOperation({ summary: "A site's routing policy (auto-assign off when never configured)" })
  get(@Param("siteId") siteId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.routingService.getPolicy(siteId, user);
  }

  @Patch(":siteId")
  @Roles(...ROUTING_POLICY_WRITE_ROLES)
  @ApiOperation({
    summary:
      "Turn offer-based auto-routing of new incidents on or off for a site, and set the accept window",
  })
  set(
    @Param("siteId") siteId: string,
    @Body() dto: UpdateRoutingPolicyDto,
    @CurrentUser() user: AuthenticatedUser,
    @CorrelationId() correlationId?: string,
  ) {
    return this.routingService.setPolicy(siteId, dto, user, { actorId: user.id, correlationId });
  }
}
