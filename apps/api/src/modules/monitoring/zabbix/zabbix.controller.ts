import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from "@nestjs/swagger";
import { UserRole } from "@prisma/client";
import { CorrelationId } from "../../../common/decorators/correlation-id.decorator";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import { Roles } from "../../auth/decorators/roles.decorator";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { AuthenticatedUser } from "../../auth/types/jwt-payload.type";
import { ZabbixIdPipe } from "./zabbix-id.pipe";
import {
  AcknowledgeZabbixProblemDto,
  ListZabbixProblemsQueryDto,
  TestZabbixConnectionDto,
  UpdateZabbixSettingsDto,
  ZabbixHistoryQueryDto,
} from "./zabbix.dto";
import { ZabbixService } from "./zabbix.service";

/** Who may see and change the connection (URL, token, on/off). */
export const ZABBIX_ADMIN_ROLES = [UserRole.SUPER_ADMIN, UserRole.DELIVERY_OPS_MANAGER] as const;

/** Every internal role; client viewers never see raw monitoring. Site scope still applies. */
export const ZABBIX_VIEW_ROLES = [
  UserRole.SUPER_ADMIN,
  UserRole.DELIVERY_OPS_MANAGER,
  UserRole.SERVICE_DESK_NOC,
  UserRole.SITE_ENGINEER,
  UserRole.INFRASTRUCTURE_LEAD,
  UserRole.VENDOR_COORDINATOR,
  UserRole.AUDITOR_READ_ONLY,
] as const;

/** Operational roles that may acknowledge a Zabbix problem from OpsDesk. */
export const ZABBIX_ACK_ROLES = [
  UserRole.SUPER_ADMIN,
  UserRole.DELIVERY_OPS_MANAGER,
  UserRole.SERVICE_DESK_NOC,
  UserRole.SITE_ENGINEER,
  UserRole.INFRASTRUCTURE_LEAD,
] as const;

/**
 * Live Zabbix views inside OpsDesk. Unlike the other monitoring routes, reads
 * here are role-gated too: settings are admin-only and raw monitoring data is
 * staff-only (no client viewers).
 */
@ApiTags("monitoring / zabbix")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("monitoring/zabbix")
export class ZabbixController {
  constructor(private readonly zabbix: ZabbixService) {}

  @Get("settings")
  @Roles(...ZABBIX_ADMIN_ROLES)
  @ApiOperation({ summary: "Zabbix connection settings (the token is never returned)" })
  getSettings() {
    return this.zabbix.getSettings();
  }

  @Put("settings")
  @Roles(...ZABBIX_ADMIN_ROLES)
  @ApiOperation({ summary: "Update the Zabbix URL, timeout, on/off switch or API token" })
  updateSettings(
    @Body() dto: UpdateZabbixSettingsDto,
    @CurrentUser() user: AuthenticatedUser,
    @CorrelationId() correlationId?: string,
  ) {
    return this.zabbix.updateSettings(dto, { actorId: user.id, correlationId });
  }

  @Post("settings/test")
  @HttpCode(200) // a read-only check, nothing is created
  @Roles(...ZABBIX_ADMIN_ROLES)
  @ApiOperation({ summary: "Run the connection checklist (optionally against unsaved values)" })
  testConnection(@Body() dto: TestZabbixConnectionDto) {
    return this.zabbix.testConnection(dto);
  }

  @Get("hosts")
  @Roles(...ZABBIX_VIEW_ROLES)
  @ApiOperation({
    summary: "Monitored hosts in the caller's sites, with availability and problem counts",
  })
  listHosts(@CurrentUser() user: AuthenticatedUser) {
    return this.zabbix.listHosts(user);
  }

  @Get("hosts/:hostId")
  @Roles(...ZABBIX_VIEW_ROLES)
  @ApiParam({ name: "hostId", description: "Zabbix host id" })
  getHost(@Param("hostId", ZabbixIdPipe) hostId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.zabbix.getHost(user, hostId);
  }

  @Get("hosts/:hostId/items")
  @Roles(...ZABBIX_VIEW_ROLES)
  @ApiOperation({ summary: "Latest value of every enabled item on a host" })
  listItems(@Param("hostId", ZabbixIdPipe) hostId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.zabbix.listItems(user, hostId);
  }

  @Get("items/:itemId/history")
  @Roles(...ZABBIX_VIEW_ROLES)
  @ApiOperation({ summary: "History for one item (hourly trends beyond 3 days, max 31 days)" })
  getHistory(
    @Param("itemId", ZabbixIdPipe) itemId: string,
    @Query() query: ZabbixHistoryQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.zabbix.getHistory(user, itemId, query);
  }

  @Get("problems")
  @Roles(...ZABBIX_VIEW_ROLES)
  @ApiOperation({ summary: "Active Zabbix problems in the caller's sites" })
  listProblems(@Query() query: ListZabbixProblemsQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.zabbix.listProblems(user, query);
  }

  @Post("problems/:eventId/acknowledge")
  @Roles(...ZABBIX_ACK_ROLES)
  @ApiOperation({ summary: "Acknowledge a Zabbix problem (audited); a message is optional" })
  acknowledge(
    @Param("eventId", ZabbixIdPipe) eventId: string,
    @Body() dto: AcknowledgeZabbixProblemDto,
    @CurrentUser() user: AuthenticatedUser,
    @CorrelationId() correlationId?: string,
  ) {
    return this.zabbix.acknowledgeProblem(user, eventId, dto, { actorId: user.id, correlationId });
  }
}
