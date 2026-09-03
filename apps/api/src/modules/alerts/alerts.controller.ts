import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { UserRole } from "@prisma/client";
import { CorrelationId } from "../../common/decorators/correlation-id.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { AuthenticatedUser } from "../auth/types/jwt-payload.type";
import { AlertsService } from "./alerts.service";
import { AlertmanagerWebhookDto } from "./dto/alertmanager-webhook.dto";
import { IngestAlertDto } from "./dto/ingest-alert.dto";
import { QueryAlertsDto } from "./dto/query-alerts.dto";
import { ZabbixWebhookBatchDto } from "./dto/zabbix-webhook.dto";

// The ingestion endpoints are machine-to-machine — the site collector calls them
// with a service-account JWT. They still require auth (spec §11: management
// interfaces never face the Internet, but the API is still guarded) and one of
// the ingest roles; the authenticated principal is the audit actor. Read
// endpoints are open to any authenticated user.
//
// The `sources/*` routes relax `forbidNonWhitelisted` (via a route-scoped pipe)
// because Zabbix media-type payloads and Alertmanager webhooks carry extra
// fields we deliberately ignore rather than 400 on.
const ALERT_INGEST_ROLES = [
  UserRole.SUPER_ADMIN,
  UserRole.SERVICE_DESK_NOC,
  UserRole.SITE_ENGINEER,
  UserRole.INFRASTRUCTURE_LEAD,
] as const;

@ApiTags("alerts")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("alerts")
export class AlertsController {
  constructor(private readonly alertsService: AlertsService) {}

  @Post("ingest")
  @Roles(...ALERT_INGEST_ROLES)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Idempotent alert ingestion from monitoring adapters and the site collector",
  })
  ingest(
    @Body() dto: IngestAlertDto,
    @CurrentUser() user: AuthenticatedUser,
    @CorrelationId() correlationId?: string,
  ) {
    return this.alertsService.ingest(dto, { actorId: user.id, correlationId });
  }

  @Post("sources/zabbix")
  @Roles(...ALERT_INGEST_ROLES)
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  @ApiOperation({ summary: "Normalize + ingest a batch of raw Zabbix webhook events" })
  ingestZabbix(
    @Body() body: ZabbixWebhookBatchDto,
    @CurrentUser() user: AuthenticatedUser,
    @CorrelationId() correlationId?: string,
  ) {
    return this.alertsService.ingestFromZabbix(body.events, { actorId: user.id, correlationId });
  }

  @Post("sources/alertmanager")
  @Roles(...ALERT_INGEST_ROLES)
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  @ApiOperation({ summary: "Normalize + ingest a Prometheus Alertmanager webhook delivery" })
  ingestAlertmanager(
    @Body() body: AlertmanagerWebhookDto,
    @CurrentUser() user: AuthenticatedUser,
    @CorrelationId() correlationId?: string,
  ) {
    return this.alertsService.ingestFromAlertmanager(body, { actorId: user.id, correlationId });
  }

  @Get()
  findAll(@Query() query: QueryAlertsDto) {
    return this.alertsService.findAll(query);
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.alertsService.findOne(id);
  }
}
