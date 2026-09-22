import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { UserRole } from "@prisma/client";
import { CorrelationId } from "../../common/decorators/correlation-id.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { AuthenticatedUser } from "../auth/types/jwt-payload.type";
import { AssignSkillDto } from "./dto/assign-skill.dto";
import { CreateSkillDto } from "./dto/create-skill.dto";
import { UpdateSkillDto } from "./dto/update-skill.dto";
import { SkillsService } from "./skills.service";

// Same write tier as EngineerShift/support-group roster changes — skill
// taxonomy and who-has-what is governance, not something staff self-edit.
const SKILL_WRITE_ROLES = [
  UserRole.SUPER_ADMIN,
  UserRole.INFRASTRUCTURE_LEAD,
  UserRole.DELIVERY_OPS_MANAGER,
] as const;

@ApiTags("skills")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("skills")
export class SkillsController {
  constructor(private readonly skillsService: SkillsService) {}

  @Get()
  findAll(@Query("activeOnly") activeOnly?: string) {
    return this.skillsService.findAllSkills(activeOnly === "true");
  }

  @Post()
  @Roles(...SKILL_WRITE_ROLES)
  create(
    @Body() dto: CreateSkillDto,
    @CurrentUser() user: AuthenticatedUser,
    @CorrelationId() correlationId?: string,
  ) {
    return this.skillsService.createSkill(dto, { actorId: user.id, correlationId });
  }

  @Patch(":id")
  @Roles(...SKILL_WRITE_ROLES)
  update(
    @Param("id") id: string,
    @Body() dto: UpdateSkillDto,
    @CurrentUser() user: AuthenticatedUser,
    @CorrelationId() correlationId?: string,
  ) {
    return this.skillsService.updateSkill(id, dto, { actorId: user.id, correlationId });
  }

  @Get("assignments")
  findAllAssignments() {
    return this.skillsService.findAllAssignments();
  }

  @Post(":id/engineers")
  @Roles(...SKILL_WRITE_ROLES)
  assign(
    @Param("id") id: string,
    @Body() dto: AssignSkillDto,
    @CurrentUser() user: AuthenticatedUser,
    @CorrelationId() correlationId?: string,
  ) {
    return this.skillsService.assignSkill(id, dto, { actorId: user.id, correlationId });
  }

  @Delete(":id/engineers/:userId")
  @Roles(...SKILL_WRITE_ROLES)
  @HttpCode(HttpStatus.NO_CONTENT)
  async unassign(
    @Param("id") id: string,
    @Param("userId") userId: string,
    @CurrentUser() user: AuthenticatedUser,
    @CorrelationId() correlationId?: string,
  ) {
    await this.skillsService.unassignSkill(id, userId, { actorId: user.id, correlationId });
  }
}
