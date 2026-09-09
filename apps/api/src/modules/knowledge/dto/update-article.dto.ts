import { CiType } from "@prisma/client";
import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsEnum, IsISO8601, IsOptional, IsString, IsUUID, Length } from "class-validator";

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
    format: "uuid",
    description: "Site this SOP is specific to. Send null / empty to make it a global runbook.",
  })
  @IsOptional()
  @IsUUID()
  siteId?: string;

  @ApiPropertyOptional({ description: "Incident category this article applies to." })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  incidentCategory?: string;

  @ApiPropertyOptional({ enum: CiType, description: "CI type this article applies to." })
  @IsOptional()
  @IsEnum(CiType)
  ciType?: CiType;

  @ApiPropertyOptional({
    description: "ISO-8601 UTC; when this approved article is next due for review.",
  })
  @IsOptional()
  @IsISO8601()
  reviewDueAt?: string;
}
