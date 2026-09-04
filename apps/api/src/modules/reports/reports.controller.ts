import { Controller, Get, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { AuthzService } from "../auth/authz.service";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { AuthenticatedUser } from "../auth/types/jwt-payload.type";
import { ReportsService } from "./reports.service";

// Read-only for every authenticated role — no @Roles restriction, matching
// AUDITOR_READ_ONLY/CTS_MANAGER_VIEWER's need to see operational health
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
}
