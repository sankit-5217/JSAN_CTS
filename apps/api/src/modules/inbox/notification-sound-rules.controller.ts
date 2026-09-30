import { Body, Controller, Get, Param, Put, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { UserRole } from "@prisma/client";
import { CorrelationId } from "../../common/decorators/correlation-id.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { AuthenticatedUser } from "../auth/types/jwt-payload.type";
import { SetSoundRuleDto } from "./dto/set-sound-rule.dto";
import { SoundRuleParamsDto } from "./dto/sound-rule-params.dto";
import { NotificationSoundRulesService } from "./notification-sound-rules.service";

// Same owners as SLA policies: how loudly the desk is paged is operational
// process config. Reads are open to any signed-in user; writes audit.
export const SOUND_RULE_WRITE_ROLES = [
  UserRole.SUPER_ADMIN,
  UserRole.DELIVERY_OPS_MANAGER,
] as const;

@ApiTags("notifications")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("notification-sound-rules")
export class NotificationSoundRulesController {
  constructor(private readonly soundRules: NotificationSoundRulesService) {}

  @Get()
  @ApiOperation({ summary: "Every notification kind x level with its sound tier" })
  list() {
    return this.soundRules.list();
  }

  @Put(":kind/:level")
  @Roles(...SOUND_RULE_WRITE_ROLES)
  @ApiOperation({ summary: "Set the sound tier for one kind and level; applies within ~30s" })
  set(
    @Param() params: SoundRuleParamsDto,
    @Body() dto: SetSoundRuleDto,
    @CurrentUser() user: AuthenticatedUser,
    @CorrelationId() correlationId?: string,
  ) {
    return this.soundRules.set(params.kind, params.level, dto.urgency, {
      actorId: user.id,
      correlationId,
    });
  }
}
