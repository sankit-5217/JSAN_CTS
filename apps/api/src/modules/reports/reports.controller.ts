import { Controller, Get, Header, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { AuthzService } from "../auth/authz.service";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { AuthenticatedUser } from "../auth/types/jwt-payload.type";
import { QueryResponseTrendDto } from "./dto/query-response-trend.dto";
import { ReportsService } from "./reports.service";

// Read-only for every authenticated role — no @Roles restriction, matching
// AUDITOR_READ_ONLY/CLIENT_MANAGER_VIEWER's need to see operational health
// too (spec §4). Site-scoped the same way as incidents/cmdb.
@ApiTags("reports")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("reports")
export class ReportsController {
  constructor(
    private readonly reportsService: ReportsService,
    private readonly authzService: AuthzService,
  ) {}

  @Get("command-center")
  async getCommandCenter(@CurrentUser() user: AuthenticatedUser) {
    const accessibleSiteIds = await this.authzService.getAccessibleSiteIds(user);
    return this.reportsService.getCommandCenterSummary(accessibleSiteIds);
  }

  // Same audience/scope as command-center above — a downloadable snapshot
  // of the same read model, not a separate authorization surface.
  @Get("operational-health.csv")
  @Header("Content-Type", "text/csv; charset=utf-8")
  @Header("Content-Disposition", 'attachment; filename="operational-health-report.csv"')
  async downloadOperationalHealthCsv(@CurrentUser() user: AuthenticatedUser): Promise<string> {
    const accessibleSiteIds = await this.authzService.getAccessibleSiteIds(user);
    return this.reportsService.generateOperationalHealthCsv(accessibleSiteIds);
  }

  // Same audience/scope as the other reports above.
  @Get("response-trend")
  async getResponseTrend(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: QueryResponseTrendDto,
  ) {
    const accessibleSiteIds = await this.authzService.getAccessibleSiteIds(user);
    return this.reportsService.getResponseTrend(accessibleSiteIds, query.windowDays ?? 30);
  }

  // Same audience/scope as the other reports above. Reuses
  // QueryResponseTrendDto — same windowDays shape as response-trend, no
  // reason to duplicate the DTO for an identical query contract.
  @Get("alert-insights")
  async getAlertInsights(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: QueryResponseTrendDto,
  ) {
    const accessibleSiteIds = await this.authzService.getAccessibleSiteIds(user);
    return this.reportsService.getAlertInsights(accessibleSiteIds, query.windowDays ?? 30);
  }
}
