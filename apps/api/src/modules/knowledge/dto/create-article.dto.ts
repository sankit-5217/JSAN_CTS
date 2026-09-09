import { CiType } from "@prisma/client";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsEnum, IsOptional, IsString, IsUUID, Length } from "class-validator";

/** A new article always starts life as DRAFT — approval is a separate step. */
export class CreateArticleDto {
  @ApiProperty({ example: "Replace a failed hot-swap PSU (Dell R650)" })
  @IsString()
  @Length(3, 300)
  title!: string;

  @ApiProperty({ description: "Runbook body (Markdown).", example: "## Pre-checks\n1. ..." })
  @IsString()
  @Length(3, 50_000)
  body!: string;

  @ApiPropertyOptional({ format: "uuid", description: "Owning engineer / SME." })
  @IsOptional()
  @IsUUID()
  ownerId?: string;

  @ApiPropertyOptional({
    format: "uuid",
    description: "Site this SOP is specific to. Omit for a global runbook.",
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
}
