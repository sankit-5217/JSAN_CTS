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
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { UserRole } from "@prisma/client";
import { CorrelationId } from "../../common/decorators/correlation-id.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { AuthenticatedUser } from "../auth/types/jwt-payload.type";
import { AddActionItemDto } from "./dto/add-action-item.dto";
import { CreateProblemDto } from "./dto/create-problem.dto";
import { LinkProblemDto } from "./dto/link-problem.dto";
import { QueryProblemsDto } from "./dto/query-problems.dto";
import { TransitionProblemDto } from "./dto/transition-problem.dto";
import { UpdateProblemDto } from "./dto/update-problem.dto";
import { ProblemsService } from "./problems.service";

// Problem/RCA management is a delivery + infrastructure function (spec §10.5).
// Not site-scoped — a problem spans incidents that may be at different sites.
const PROBLEM_WRITE_ROLES = [
  UserRole.SUPER_ADMIN,
  UserRole.DELIVERY_OPS_MANAGER,
  UserRole.INFRASTRUCTURE_LEAD,
] as const;

@ApiTags("problems")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("problems")
export class ProblemsController {
  constructor(private readonly problems: ProblemsService) {}

  @Post()
  @Roles(...PROBLEM_WRITE_ROLES)
  @ApiOperation({ summary: "Open a problem record for repeated / major incidents (spec §10.5)" })
  create(
    @Body() dto: CreateProblemDto,
    @CurrentUser() user: AuthenticatedUser,
    @CorrelationId() correlationId?: string,
  ) {
    return this.problems.create(dto, { actorId: user.id, correlationId });
  }

  @Get()
  @ApiOperation({ summary: "List problems (filter by status / owner)" })
  findAll(@Query() query: QueryProblemsDto) {
    return this.problems.list(query);
  }

  @Get(":id")
  @ApiOperation({ summary: "Get a problem with its action items and linked incidents / changes" })
  findOne(@Param("id") id: string) {
    return this.problems.getOne(id);
  }

  @Patch(":id")
  @Roles(...PROBLEM_WRITE_ROLES)
  @ApiOperation({
    summary: "Edit RCA fields (symptoms, root cause, corrective / preventive action)",
  })
  update(
    @Param("id") id: string,
    @Body() dto: UpdateProblemDto,
    @CurrentUser() user: AuthenticatedUser,
    @CorrelationId() correlationId?: string,
  ) {
    return this.problems.update(id, dto, { actorId: user.id, correlationId });
  }

  @Post(":id/transition")
  @Roles(...PROBLEM_WRITE_ROLES)
  @ApiOperation({ summary: "Move the problem through its lifecycle (RESOLVED needs a root cause)" })
  transition(
    @Param("id") id: string,
    @Body() dto: TransitionProblemDto,
    @CurrentUser() user: AuthenticatedUser,
    @CorrelationId() correlationId?: string,
  ) {
    return this.problems.transition(id, dto, { actorId: user.id, correlationId });
  }

  @Post(":id/action-items")
  @Roles(...PROBLEM_WRITE_ROLES)
  @ApiOperation({ summary: "Add a corrective / preventive action item" })
  addActionItem(
    @Param("id") id: string,
    @Body() dto: AddActionItemDto,
    @CurrentUser() user: AuthenticatedUser,
    @CorrelationId() correlationId?: string,
  ) {
    return this.problems.addActionItem(id, dto, { actorId: user.id, correlationId });
  }

  @Patch(":id/action-items/:itemId")
  @Roles(...PROBLEM_WRITE_ROLES)
  @ApiOperation({ summary: "Mark an action item complete (idempotent)" })
  completeActionItem(
    @Param("id") id: string,
    @Param("itemId") itemId: string,
    @CurrentUser() user: AuthenticatedUser,
    @CorrelationId() correlationId?: string,
  ) {
    return this.problems.completeActionItem(id, itemId, { actorId: user.id, correlationId });
  }

  @Post(":id/links")
  @Roles(...PROBLEM_WRITE_ROLES)
  @ApiOperation({ summary: "Link a related incident or change (409 if already linked)" })
  link(
    @Param("id") id: string,
    @Body() dto: LinkProblemDto,
    @CurrentUser() user: AuthenticatedUser,
    @CorrelationId() correlationId?: string,
  ) {
    return this.problems.link(id, dto, { actorId: user.id, correlationId });
  }

  @Delete(":id/links/:linkId")
  @Roles(...PROBLEM_WRITE_ROLES)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Remove a link" })
  unlink(
    @Param("id") id: string,
    @Param("linkId") linkId: string,
    @CurrentUser() user: AuthenticatedUser,
    @CorrelationId() correlationId?: string,
  ) {
    return this.problems.unlink(id, linkId, { actorId: user.id, correlationId });
  }
}
