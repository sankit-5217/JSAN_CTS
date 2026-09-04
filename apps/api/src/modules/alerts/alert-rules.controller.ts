import { Body, Controller, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { UserRole } from "@prisma/client";
import { CorrelationId } from "../../common/decorators/correlation-id.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { AuthenticatedUser } from "../auth/types/jwt-payload.type";
import { AlertRulesService } from "./alert-rules.service";
import { CreateAlertRuleDto } from "./dto/create-alert-rule.dto";
import { UpdateAlertRuleDto } from "./dto/update-alert-rule.dto";

// Ingestion policy is monitoring config, not commercial config — infra owns it
// (spec §10.10). Reads are open to any authenticated user; writes audit.
const ALERT_RULE_WRITE_ROLES = [UserRole.SUPER_ADMIN, UserRole.INFRASTRUCTURE_LEAD] as const;

// Own path (not nested under /alerts) so it never collides with GET /alerts/:id.
@ApiTags("alerts")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("alert-rules")
export class AlertRulesController {
  constructor(private readonly alertRules: AlertRulesService) {}

  @Get()
  @ApiOperation({ summary: "List alert ingestion policy rows (newest first)" })
  findAll() {
    return this.alertRules.list();
  }

  @Get(":id")
  @ApiOperation({ summary: "Get one alert rule" })
  findOne(@Param("id") id: string) {
    return this.alertRules.findOne(id);
  }

  @Post()
  @Roles(...ALERT_RULE_WRITE_ROLES)
  @ApiOperation({
    summary: "Create an alert rule (flapping thresholds, paging severities, auto-correlation)",
  })
  create(
    @Body() dto: CreateAlertRuleDto,
    @CurrentUser() user: AuthenticatedUser,
    @CorrelationId() correlationId?: string,
  ) {
    return this.alertRules.create(dto, { actorId: user.id, correlationId });
  }

  @Patch(":id")
  @Roles(...ALERT_RULE_WRITE_ROLES)
  @ApiOperation({ summary: "Patch an alert rule; the ingest path picks it up within ~30s" })
  update(
    @Param("id") id: string,
    @Body() dto: UpdateAlertRuleDto,
    @CurrentUser() user: AuthenticatedUser,
    @CorrelationId() correlationId?: string,
  ) {
    return this.alertRules.update(id, dto, { actorId: user.id, correlationId });
  }
}
