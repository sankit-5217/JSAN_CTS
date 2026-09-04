import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { CorrelationId } from "../../common/decorators/correlation-id.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { AuthenticatedUser } from "../auth/types/jwt-payload.type";
import { WarrantyResyncDto } from "./dto/warranty-resync.dto";
import { WarrantyResyncService } from "./warranty-resync.service";
import { VENDOR_WRITE_ROLES } from "./vendors.controller";

/**
 * Vendor warranty resync (spec §10.13). Same write roles as the rest of the
 * vendors module. Invoked on demand by a coordinator, and nightly by
 * `apps/worker` with a service token that resolves to one of these roles.
 */
@ApiTags("vendors")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("vendors/warranty-sync")
export class WarrantyController {
  constructor(private readonly warrantyResync: WarrantyResyncService) {}

  @Post()
  @Roles(...VENDOR_WRITE_ROLES)
  @ApiOperation({
    summary: "Refresh hardware warranty coverage for CIs from the configured vendor providers",
    description:
      "Sweeps every CI that has a service tag (or only `ciIds` when supplied), looks up current " +
      "coverage from the enabled Dell/HPE providers, and appends a new warranty record plus a " +
      "WARRANTY_REFRESHED audit event only when coverage actually changed. Unmapped vendors and " +
      "provider errors are reported per-CI; the batch always completes.",
  })
  resync(
    @Body() dto: WarrantyResyncDto,
    @CurrentUser() user: AuthenticatedUser,
    @CorrelationId() correlationId?: string,
  ) {
    return this.warrantyResync.run({ actorId: user.id, correlationId }, { ciIds: dto.ciIds });
  }
}
