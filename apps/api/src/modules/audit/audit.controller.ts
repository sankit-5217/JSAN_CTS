import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { UserRole } from "@prisma/client";
import { Roles } from "../auth/decorators/roles.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { AuditService } from "./audit.service";
import { ListAuditEventsQueryDto } from "./dto/list-audit-events-query.dto";

// Full audit visibility is restricted to the two roles the spec (§4) gives
// it to: AUDITOR_READ_ONLY ("Full read access to logs, worklogs, no
// write") and SUPER_ADMIN. Not site-scoped -- an audit trail spanning
// sites is exactly what an auditor reconstructing an incident needs, and
// restricting it per-site would defeat the point.
const AUDIT_READ_ROLES = [UserRole.SUPER_ADMIN, UserRole.AUDITOR_READ_ONLY] as const;

@ApiTags("audit")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("audit")
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  @Roles(...AUDIT_READ_ROLES)
  findAll(@Query() query: ListAuditEventsQueryDto) {
    return this.auditService.findAll(query);
  }
}
