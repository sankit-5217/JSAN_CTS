import { ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsUUID, Max, Min } from "class-validator";
import { PROBLEM_STATUSES } from "../problems.constants";
import type { ProblemStatus } from "../problems.constants";

/** Read-side filters for `GET /problems`. */
export class QueryProblemsDto {
  @ApiPropertyOptional({ enum: [...PROBLEM_STATUSES] })
  @IsOptional()
  @IsIn(PROBLEM_STATUSES)
  status?: ProblemStatus;

  @ApiPropertyOptional({ description: "Filter to a problem owner (user id)." })
  @IsOptional()
  @IsUUID()
  ownerUserId?: string;

  @ApiPropertyOptional({ default: 50, minimum: 1, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}
