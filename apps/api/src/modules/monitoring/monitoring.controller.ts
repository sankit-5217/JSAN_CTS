import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { UserRole } from "@prisma/client";
import { CorrelationId } from "../../common/decorators/correlation-id.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { AuthenticatedUser } from "../auth/types/jwt-payload.type";
import { CollectorHeartbeatDto } from "./dto/collector-heartbeat.dto";
import { HealthSnapshotBatchDto } from "./dto/health-snapshot.dto";
import { MonitoringService } from "./monitoring.service";
import { AuthzService } from "../auth/authz.service";

// The ingest route is machine-to-machine — the site collector posts with a
// service-account JWT, same roles as the alert-source routes. Reads are open to
// any authenticated user.
const HEALTH_INGEST_ROLES = [
  UserRole.SUPER_ADMIN,
  UserRole.SERVICE_DESK_NOC,
  UserRole.SITE_ENGINEER,
  UserRole.INFRASTRUCTURE_LEAD,
] as const;

@ApiTags("monitoring")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("monitoring")
export class MonitoringController {
  constructor(
    private readonly monitoringService: MonitoringService,
    private readonly authz: AuthzService,
  ) {}

  @Post("health-snapshots")
  // Machine intake: never 429 a monitoring source (it would drop the event).
  @SkipThrottle()
  @Roles(...HEALTH_INGEST_ROLES)
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  @ApiOperation({
    summary: "Upsert a batch of hardware health snapshots from the site collector",
  })
  record(
    @Body() body: HealthSnapshotBatchDto,
    @CurrentUser() user: AuthenticatedUser,
    @CorrelationId() correlationId?: string,
  ) {
    return this.monitoringService.recordSnapshots(body.snapshots, {
      actorId: user.id,
      correlationId,
    });
  }

  @Get("health-snapshots/:ciCode")
  @ApiOperation({ summary: "Current health snapshot for a CI" })
  async getForCi(@Param("ciCode") ciCode: string, @CurrentUser() user: AuthenticatedUser) {
    return this.monitoringService.getForCi(ciCode, await this.authz.getAccessibleSiteIds(user));
  }

  @Get("collector-heartbeats")
  @Roles(...HEALTH_INGEST_ROLES, UserRole.DELIVERY_OPS_MANAGER, UserRole.AUDITOR_READ_ONLY)
  @ApiOperation({ summary: "Each site's last collector ping (to spot a silent collector)" })
  async heartbeats(@CurrentUser() user: AuthenticatedUser) {
    return this.monitoringService.listHeartbeats(await this.authz.getAccessibleSiteIds(user));
  }

  @Post("collector-heartbeat")
  // Machine intake: never 429 a monitoring source (it would drop the event).
  @SkipThrottle()
  @Roles(...HEALTH_INGEST_ROLES)
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  @ApiOperation({ summary: "Site collector liveness ping (spec §26)" })
  heartbeat(
    @Body() body: CollectorHeartbeatDto,
    @CurrentUser() user: AuthenticatedUser,
    @CorrelationId() correlationId?: string,
  ) {
    return this.monitoringService.recordHeartbeat(body.siteCode, {
      actorId: user.id,
      correlationId,
    });
  }
}
