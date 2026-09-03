import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { UserRole } from "@prisma/client";
import { CorrelationId } from "../../common/decorators/correlation-id.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { AuthenticatedUser } from "../auth/types/jwt-payload.type";
import { KnowledgeService } from "./knowledge.service";
import { ApproveArticleDto } from "./dto/approve-article.dto";
import { CreateArticleDto } from "./dto/create-article.dto";
import { QueryArticlesDto } from "./dto/query-articles.dto";
import { UnpublishArticleDto } from "./dto/unpublish-article.dto";
import { UpdateArticleDto } from "./dto/update-article.dto";

// Approval, the version bump on edit, and the "owner cannot self-approve" rule
// are backend state rules — never trust the client (spec §4, §12). Articles have
// no site link, so no SiteScopeGuard; reads are open to any authenticated user.
const KB_DRAFT_ROLES = [
  UserRole.SUPER_ADMIN,
  UserRole.DELIVERY_OPS_MANAGER,
  UserRole.INFRASTRUCTURE_LEAD,
  UserRole.SITE_ENGINEER,
  UserRole.SERVICE_DESK_NOC,
] as const;
const KB_APPROVE_ROLES = [
  UserRole.SUPER_ADMIN,
  UserRole.DELIVERY_OPS_MANAGER,
  UserRole.INFRASTRUCTURE_LEAD,
] as const;

@ApiTags("knowledge")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("knowledge")
export class KnowledgeController {
  constructor(private readonly knowledgeService: KnowledgeService) {}

  @Post()
  @Roles(...KB_DRAFT_ROLES)
  create(
    @Body() dto: CreateArticleDto,
    @CurrentUser() user: AuthenticatedUser,
    @CorrelationId() correlationId?: string,
  ) {
    return this.knowledgeService.create(dto, { actorId: user.id, correlationId });
  }

  @Get()
  findAll(@Query() query: QueryArticlesDto) {
    return this.knowledgeService.list(query);
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.knowledgeService.getOne(id);
  }

  @Patch(":id")
  @Roles(...KB_DRAFT_ROLES)
  @ApiOperation({
    summary: "Edit an article. Changing title/body bumps the version and reverts it to DRAFT.",
  })
  update(
    @Param("id") id: string,
    @Body() dto: UpdateArticleDto,
    @CurrentUser() user: AuthenticatedUser,
    @CorrelationId() correlationId?: string,
  ) {
    return this.knowledgeService.update(id, dto, { actorId: user.id, correlationId });
  }

  @Post(":id/approve")
  @Roles(...KB_APPROVE_ROLES)
  @ApiOperation({
    summary: "Approve an article as an authoritative runbook (409 if already approved)",
  })
  approve(
    @Param("id") id: string,
    @Body() dto: ApproveArticleDto,
    @CurrentUser() user: AuthenticatedUser,
    @CorrelationId() correlationId?: string,
  ) {
    return this.knowledgeService.approve(id, dto, { actorId: user.id, correlationId });
  }

  @Post(":id/unpublish")
  @Roles(...KB_APPROVE_ROLES)
  @ApiOperation({ summary: "Pull an approved runbook back to DRAFT (e.g. found unsafe)" })
  unpublish(
    @Param("id") id: string,
    @Body() dto: UnpublishArticleDto,
    @CurrentUser() user: AuthenticatedUser,
    @CorrelationId() correlationId?: string,
  ) {
    return this.knowledgeService.unpublish(id, dto, { actorId: user.id, correlationId });
  }
}
