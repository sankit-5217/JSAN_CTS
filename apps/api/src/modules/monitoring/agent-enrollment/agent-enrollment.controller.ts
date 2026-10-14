import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { CorrelationId } from "../../../common/decorators/correlation-id.decorator";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import { Roles } from "../../auth/decorators/roles.decorator";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { AuthenticatedUser } from "../../auth/types/jwt-payload.type";
import { ZABBIX_ADMIN_ROLES } from "../zabbix/zabbix.controller";
import {
  CreateAgentEnrollmentDto,
  ListAgentEnrollmentsQueryDto,
  RegisterAgentDto,
} from "./agent-enrollment.dto";
import { AgentEnrollmentService } from "./agent-enrollment.service";

/** Admins create, list and revoke per-site enrollment links. */
@ApiTags("monitoring / agent enrollment")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("monitoring/agent-enrollments")
export class AgentEnrollmentController {
  constructor(private readonly enrollments: AgentEnrollmentService) {}

  @Post()
  @Roles(...ZABBIX_ADMIN_ROLES)
  @ApiOperation({
    summary: "Create an enrollment link for a site (the code and commands are shown only once)",
  })
  create(
    @Body() dto: CreateAgentEnrollmentDto,
    @CurrentUser() user: AuthenticatedUser,
    @CorrelationId() correlationId?: string,
  ) {
    return this.enrollments.create(dto, { actorId: user.id, correlationId });
  }

  @Get()
  @Roles(...ZABBIX_ADMIN_ROLES)
  @ApiOperation({ summary: "Enrollment links (never the codes)" })
  list(@Query() query: ListAgentEnrollmentsQueryDto) {
    return this.enrollments.list(query.siteId);
  }

  @Post(":id/revoke")
  @HttpCode(200)
  @Roles(...ZABBIX_ADMIN_ROLES)
  @ApiOperation({ summary: "Revoke a link: no new machines can use it (enrolled ones keep working)" })
  revoke(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @CorrelationId() correlationId?: string,
  ) {
    return this.enrollments.revoke(id, { actorId: user.id, correlationId });
  }
}

/**
 * What the client's machine calls — authenticated by the enrollment code in
 * the path (32 random bytes, stored only as a hash, expires, revocable), not
 * by a user session. Rate-limited per IP. An unknown/expired/revoked code
 * gets a script that explains it and exits non-zero (never the installer).
 */
@ApiTags("monitoring / agent enrollment")
@Throttle({ default: { limit: 30, ttl: 60_000 } })
@Controller("enroll")
export class AgentEnrollmentPublicController {
  constructor(private readonly enrollments: AgentEnrollmentService) {}

  @Get(":code/install.sh")
  @Header("Content-Type", "text/x-shellscript; charset=utf-8")
  @Header("Cache-Control", "no-store")
  @ApiOperation({ summary: "Linux installer: curl -fsSL .../install.sh | sudo bash" })
  linux(@Param("code") code: string) {
    return this.enrollments.installerOrError(code, "linux");
  }

  @Get(":code/install.ps1")
  @Header("Content-Type", "text/plain; charset=utf-8")
  @Header("Cache-Control", "no-store")
  @ApiOperation({ summary: "Windows installer: irm .../install.ps1 | iex" })
  windows(@Param("code") code: string) {
    return this.enrollments.installerOrError(code, "windows");
  }

  @Post(":code/register")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  @ApiOperation({ summary: "Called by the installer: registers the machine, returns its agent settings" })
  register(@Param("code") code: string, @Body() dto: RegisterAgentDto) {
    return this.enrollments.register(code, dto);
  }
}
