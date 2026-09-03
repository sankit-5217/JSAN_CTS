import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../../common/prisma/prisma.service";
import { deriveKnowledgeView } from "./knowledge.status";
import { ApproveArticleDto } from "./dto/approve-article.dto";
import { CreateArticleDto } from "./dto/create-article.dto";
import { QueryArticlesDto } from "./dto/query-articles.dto";
import { UnpublishArticleDto } from "./dto/unpublish-article.dto";
import { UpdateArticleDto } from "./dto/update-article.dto";

/**
 * Owns: SOPs / runbooks, their versions and approval state (spec §10.14, §12).
 * Must not own: incident creation. `authoritative` is derived (approvalState +
 * reviewDueAt), never stored — see `knowledge.status.ts`.
 */
@Injectable()
export class KnowledgeService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateArticleDto) {
    // approvalState defaults to DRAFT and version to 1 in the schema.
    // TODO(audit): emit KNOWLEDGE_ARTICLE_CREATED once the audit module lands.
    const article = await this.prisma.knowledgeArticle.create({
      data: {
        title: dto.title,
        body: dto.body,
        ...(dto.ownerId !== undefined ? { ownerId: dto.ownerId } : {}),
      },
    });
    return this.decorate(article);
  }

  async list(query: QueryArticlesDto) {
    const now = new Date();
    // AND-array (not object spread): `q` and `view` both contribute an `OR`,
    // which would otherwise collide on the same key.
    const and: Prisma.KnowledgeArticleWhereInput[] = [];

    if (query.approvalState) {
      and.push({ approvalState: query.approvalState });
    }
    if (query.ownerId) {
      and.push({ ownerId: query.ownerId });
    }
    if (query.q) {
      and.push({
        OR: [
          { title: { contains: query.q, mode: "insensitive" } },
          { body: { contains: query.q, mode: "insensitive" } },
        ],
      });
    }
    if (query.view === "authoritative") {
      and.push({
        approvalState: "APPROVED",
        OR: [{ reviewDueAt: null }, { reviewDueAt: { gte: now } }],
      });
    } else if (query.view === "review-overdue") {
      and.push({ approvalState: "APPROVED", reviewDueAt: { lt: now } });
    }

    const articles = await this.prisma.knowledgeArticle.findMany({
      where: and.length ? { AND: and } : {},
      orderBy: { updatedAt: "desc" },
      take: query.limit ?? 50,
    });
    return articles.map((article) => this.decorate(article, now));
  }

  async getOne(id: string) {
    return this.decorate(await this.requireArticle(id));
  }

  async update(id: string, dto: UpdateArticleDto) {
    const article = await this.requireArticle(id);

    const contentChanged =
      (dto.title !== undefined && dto.title !== article.title) ||
      (dto.body !== undefined && dto.body !== article.body);

    const data: Prisma.KnowledgeArticleUpdateInput = {
      ...(dto.title !== undefined ? { title: dto.title } : {}),
      ...(dto.body !== undefined ? { body: dto.body } : {}),
      ...(dto.ownerId !== undefined ? { ownerId: dto.ownerId } : {}),
    };

    if (contentChanged) {
      // A changed runbook is no longer the thing that was approved: bump the
      // version, drop to DRAFT and clear the (now stale) review date.
      data.version = { increment: 1 };
      data.approvalState = "DRAFT";
      data.reviewDueAt = null;
    } else if (dto.reviewDueAt !== undefined) {
      data.reviewDueAt = new Date(dto.reviewDueAt);
    }

    // TODO(audit): emit KNOWLEDGE_ARTICLE_UPDATED with a before/after diff and
    // whether the edit revoked approval.
    const updated = await this.prisma.knowledgeArticle.update({ where: { id }, data });
    return this.decorate(updated);
  }

  async approve(id: string, dto: ApproveArticleDto) {
    const article = await this.requireArticle(id);
    if (article.approvalState === "APPROVED") {
      throw new ConflictException(`Knowledge article ${id} is already approved`);
    }
    if (article.ownerId && article.ownerId === dto.approverId) {
      throw new BadRequestException("An article cannot be approved by its owner");
    }
    const reviewDueAt = new Date(dto.reviewDueAt);
    if (reviewDueAt.getTime() <= Date.now()) {
      throw new BadRequestException("reviewDueAt must be in the future");
    }

    // TODO(audit): emit KNOWLEDGE_ARTICLE_APPROVED (approverId, version, reviewDueAt).
    const updated = await this.prisma.knowledgeArticle.update({
      where: { id },
      data: { approvalState: "APPROVED", reviewDueAt },
    });
    return this.decorate(updated);
  }

  async unpublish(id: string, dto: UnpublishArticleDto) {
    const article = await this.requireArticle(id);
    if (article.approvalState !== "APPROVED") {
      throw new ConflictException(`Knowledge article ${id} is not published`);
    }

    // TODO(audit): emit KNOWLEDGE_ARTICLE_UNPUBLISHED (reason).
    void dto.reason;
    const updated = await this.prisma.knowledgeArticle.update({
      where: { id },
      data: { approvalState: "DRAFT", reviewDueAt: null },
    });
    return this.decorate(updated);
  }

  /**
   * Cross-module guard (spec §12: knowledge must not own incident creation, but
   * incidents/changes may only *link* a runbook that is currently authoritative).
   * Throws unless the article is APPROVED and not past its review date.
   */
  async requireAuthoritative(id: string) {
    const article = await this.requireArticle(id);
    const view = deriveKnowledgeView(article);
    if (!view.authoritative) {
      throw new ConflictException(
        `Knowledge article ${id} is not authoritative (${
          view.reviewOverdue ? "review overdue" : article.approvalState.toLowerCase()
        })`,
      );
    }
    return { ...article, ...view };
  }

  private async requireArticle(id: string) {
    const article = await this.prisma.knowledgeArticle.findUnique({ where: { id } });
    if (!article) {
      throw new NotFoundException(`Knowledge article ${id} not found`);
    }
    return article;
  }

  private decorate<T extends Parameters<typeof deriveKnowledgeView>[0]>(article: T, now?: Date) {
    return { ...article, ...deriveKnowledgeView(article, now) };
  }
}
