import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UsePipes,
  ValidationPipe,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { AlertsService } from "./alerts.service";
import { AlertmanagerWebhookDto } from "./dto/alertmanager-webhook.dto";
import { IngestAlertDto } from "./dto/ingest-alert.dto";
import { QueryAlertsDto } from "./dto/query-alerts.dto";
import { ZabbixWebhookBatchDto } from "./dto/zabbix-webhook.dto";

// NOTE: the ingestion endpoints are called by monitoring adapters and the site
// collector, never by a browser. Authenticate them with a per-source shared
// secret / mTLS client cert once the auth module lands (spec §11) — until then
// they must not be reachable from outside the cluster. The read endpoints get
// RBAC + site-scope guards from the auth module (spec §4); do not rely on the
// UI to hide alerts.
//
// The `sources/*` routes relax `forbidNonWhitelisted` (via a route-scoped pipe)
// because Zabbix media-type payloads and Alertmanager webhooks carry extra
// fields we deliberately ignore rather than 400 on.
@ApiTags("alerts")
@Controller("alerts")
export class AlertsController {
  constructor(private readonly alertsService: AlertsService) {}

  @Post("ingest")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Idempotent alert ingestion from monitoring adapters and the site collector",
  })
  ingest(@Body() dto: IngestAlertDto) {
    return this.alertsService.ingest(dto);
  }

  @Post("sources/zabbix")
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  @ApiOperation({ summary: "Normalize + ingest a batch of raw Zabbix webhook events" })
  ingestZabbix(@Body() body: ZabbixWebhookBatchDto) {
    return this.alertsService.ingestFromZabbix(body.events);
  }

  @Post("sources/alertmanager")
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  @ApiOperation({ summary: "Normalize + ingest a Prometheus Alertmanager webhook delivery" })
  ingestAlertmanager(@Body() body: AlertmanagerWebhookDto) {
    return this.alertsService.ingestFromAlertmanager(body);
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
