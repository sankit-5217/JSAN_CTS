import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Priority, UserRole } from "@prisma/client";
import { CorrelationId } from "../../common/decorators/correlation-id.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { AuthenticatedUser } from "../auth/types/jwt-payload.type";
import { CreateSlaPolicyDto } from "./dto/create-sla-policy.dto";
import { UpdateSlaPolicyDto } from "./dto/update-sla-policy.dto";
import { SlaService } from "./sla.service";

// SLA policy is contract/platform config (spec §10.8: "CTS/JSAN must
// confirm contractual SLA values ... before production") — same write-role
// tier as sites master data (SitesController's SITE_MASTER_WRITE_ROLES,
// minus INFRASTRUCTURE_LEAD — SLA targets are a delivery/commercial call,
// not a technical one).
const SLA_POLICY_WRITE_ROLES = [UserRole.SUPER_ADMIN, UserRole.DELIVERY_OPS_MANAGER] as const;

// Not site-scoped — SlaPolicy is global (Sprint 6 plan, Decision 5) — so
// no SiteScopeGuard, matching SupportGroupsController's precedent.
@ApiTags("sla")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("sla/policies")
export class SlaController {
  constructor(private readonly slaService: SlaService) {}

  @Get()
  findAll(@Query("priority") priority?: Priority) {
    return this.slaService.listPolicies(priority);
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.slaService.findPolicy(id);
  }

  @Post()
  @Roles(...SLA_POLICY_WRITE_ROLES)
  create(
    @Body() dto: CreateSlaPolicyDto,
    @CurrentUser() user: AuthenticatedUser,
    @CorrelationId() correlationId?: string,
  ) {
    return this.slaService.createPolicy(dto, { actorId: user.id, correlationId });
  }

  @Patch(":id")
  @Roles(...SLA_POLICY_WRITE_ROLES)
  update(
    @Param("id") id: string,
    @Body() dto: UpdateSlaPolicyDto,
    @CurrentUser() user: AuthenticatedUser,
    @CorrelationId() correlationId?: string,
  ) {
    return this.slaService.updatePolicy(id, dto, { actorId: user.id, correlationId });
  }
}
