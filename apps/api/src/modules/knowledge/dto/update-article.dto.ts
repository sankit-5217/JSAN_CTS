import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsISO8601, IsOptional, IsString, IsUUID, Length } from "class-validator";

/**
 * Any change to `title` or `body` bumps the version and reverts the article to
 * DRAFT (see KnowledgeService.update). Owner / review-date edits are metadata
 * only and do not bump the version.
 */
export class UpdateArticleDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(3, 300)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(3, 50_000)
  body?: string;

  @ApiPropertyOptional({ format: "uuid" })
  @IsOptional()
  @IsUUID()
  ownerId?: string;

  @ApiPropertyOptional({
    description: "ISO-8601 UTC; when this approved article is next due for review.",
  })
  @IsOptional()
  @IsISO8601()
  reviewDueAt?: string;
}
