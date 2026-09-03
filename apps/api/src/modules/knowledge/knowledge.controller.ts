import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { KnowledgeService } from "./knowledge.service";
import { ApproveArticleDto } from "./dto/approve-article.dto";
import { CreateArticleDto } from "./dto/create-article.dto";
import { QueryArticlesDto } from "./dto/query-articles.dto";
import { UnpublishArticleDto } from "./dto/unpublish-article.dto";
import { UpdateArticleDto } from "./dto/update-article.dto";

// NOTE: RBAC (any engineer drafts; INFRASTRUCTURE_LEAD / DELIVERY_OPS_MANAGER
// approve or unpublish) + site/customer scope are enforced here once the auth
// guard lands (spec §4). Approval, the version bump on edit, and the "owner
// cannot self-approve" rule are backend state rules — never trust the client.
@ApiTags("knowledge")
@Controller("knowledge")
export class KnowledgeController {
  constructor(private readonly knowledgeService: KnowledgeService) {}

  @Post()
  create(@Body() dto: CreateArticleDto) {
    return this.knowledgeService.create(dto);
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
  @ApiOperation({
    summary: "Edit an article. Changing title/body bumps the version and reverts it to DRAFT.",
  })
  update(@Param("id") id: string, @Body() dto: UpdateArticleDto) {
    return this.knowledgeService.update(id, dto);
  }

  @Post(":id/approve")
  @ApiOperation({
    summary: "Approve an article as an authoritative runbook (409 if already approved)",
  })
  approve(@Param("id") id: string, @Body() dto: ApproveArticleDto) {
    return this.knowledgeService.approve(id, dto);
  }

  @Post(":id/unpublish")
  @ApiOperation({ summary: "Pull an approved runbook back to DRAFT (e.g. found unsafe)" })
  unpublish(@Param("id") id: string, @Body() dto: UnpublishArticleDto) {
    return this.knowledgeService.unpublish(id, dto);
  }
}
