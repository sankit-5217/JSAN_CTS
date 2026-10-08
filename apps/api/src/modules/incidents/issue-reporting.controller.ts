import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { UserRole } from "@prisma/client";
import { CorrelationId } from "../../common/decorators/correlation-id.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { AuthenticatedUser } from "../auth/types/jwt-payload.type";
import {
  CreateIssueCatalogOptionDto,
  CreateIssueTemplateDto,
  UpdateIssueCatalogOptionDto,
  UpdateIssueTemplateDto,
} from "./dto/issue-catalog.dto";
import { IssueReportingService } from "./issue-reporting.service";

// Same governance tier as support-group rosters: what a reporter can pick
// from is an operations-management decision, not a Service Desk edit.
export const ISSUE_REPORTING_ADMIN_ROLES = [
  UserRole.SUPER_ADMIN,
  UserRole.DELIVERY_OPS_MANAGER,
] as const;

// Who may open the Issue reporting configuration page at all: the admins
// above plus the Service Desk (read-only). Engineers and the other roles
// never see the configuration — they only see its effect on tickets. The
// form's own GET /catalog stays open to every signed-in user (the client
// portal and the incident page render from it).
export const ISSUE_REPORTING_VIEW_ROLES = [
  ...ISSUE_REPORTING_ADMIN_ROLES,
  UserRole.SERVICE_DESK_NOC,
] as const;

/**
 * Configuration behind the "Report an issue" form. Reads are open to every
 * signed-in user (the client portal renders the form from GET /catalog);
 * writes are admin-only. Its own prefix rather than /incidents/... so the
 * static paths never collide with /incidents/:id.
 */
@ApiTags("issue-reporting")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("issue-reporting")
export class IssueReportingController {
  constructor(private readonly service: IssueReportingService) {}

  @Get("catalog")
  @ApiOperation({ summary: "Active pick-lists, templates and default assignee group for the form" })
  getCatalog() {
    return this.service.getCatalog();
  }

  @Get("options")
  @Roles(...ISSUE_REPORTING_VIEW_ROLES)
  @ApiOperation({ summary: "Every catalog option, including retired ones (admin list)" })
  listOptions(@Query("includeInactive") includeInactive?: string) {
    return this.service.listOptions(includeInactive === "true" || includeInactive === "1");
  }

  @Post("options")
  @Roles(...ISSUE_REPORTING_ADMIN_ROLES)
  createOption(
    @Body() dto: CreateIssueCatalogOptionDto,
    @CurrentUser() user: AuthenticatedUser,
    @CorrelationId() correlationId?: string,
  ) {
    return this.service.createOption(dto, { actorId: user.id, correlationId });
  }

  @Patch("options/:id")
  @Roles(...ISSUE_REPORTING_ADMIN_ROLES)
  updateOption(
    @Param("id") id: string,
    @Body() dto: UpdateIssueCatalogOptionDto,
    @CurrentUser() user: AuthenticatedUser,
    @CorrelationId() correlationId?: string,
  ) {
    return this.service.updateOption(id, dto, { actorId: user.id, correlationId });
  }

  @Get("templates")
  @Roles(...ISSUE_REPORTING_VIEW_ROLES)
  listTemplates(@Query("includeInactive") includeInactive?: string) {
    return this.service.listTemplates(includeInactive === "true" || includeInactive === "1");
  }

  @Post("templates")
  @Roles(...ISSUE_REPORTING_ADMIN_ROLES)
  createTemplate(
    @Body() dto: CreateIssueTemplateDto,
    @CurrentUser() user: AuthenticatedUser,
    @CorrelationId() correlationId?: string,
  ) {
    return this.service.createTemplate(dto, { actorId: user.id, correlationId });
  }

  @Patch("templates/:id")
  @Roles(...ISSUE_REPORTING_ADMIN_ROLES)
  updateTemplate(
    @Param("id") id: string,
    @Body() dto: UpdateIssueTemplateDto,
    @CurrentUser() user: AuthenticatedUser,
    @CorrelationId() correlationId?: string,
  ) {
    return this.service.updateTemplate(id, dto, { actorId: user.id, correlationId });
  }
}
