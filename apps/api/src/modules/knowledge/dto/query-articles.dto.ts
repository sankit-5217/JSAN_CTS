import { ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, Min } from "class-validator";
import { APPROVAL_STATES, KNOWLEDGE_VIEWS } from "../knowledge.constants";
import type { ApprovalState, KnowledgeView } from "../knowledge.constants";

/** Read-side filters for `GET /knowledge`. */
export class QueryArticlesDto {
  @ApiPropertyOptional({ enum: [...APPROVAL_STATES] })
  @IsOptional()
  @IsIn(APPROVAL_STATES)
  approvalState?: ApprovalState;

  @ApiPropertyOptional({ format: "uuid" })
  @IsOptional()
  @IsUUID()
  ownerId?: string;

  @ApiPropertyOptional({ description: "Case-insensitive substring match on title or body." })
  @IsOptional()
  @IsString()
  @Length(1, 200)
  q?: string;

  @ApiPropertyOptional({
    enum: [...KNOWLEDGE_VIEWS],
    description:
      "'authoritative' = approved and not past review; 'review-overdue' = approved but review date passed.",
  })
  @IsOptional()
  @IsIn(KNOWLEDGE_VIEWS)
  view?: KnowledgeView;

  @ApiPropertyOptional({ default: 50, minimum: 1, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}
