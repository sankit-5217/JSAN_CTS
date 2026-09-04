import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsOptional, IsString, Length } from "class-validator";
import { PROBLEM_STATUSES } from "../problems.constants";
import type { ProblemStatus } from "../problems.constants";

export class TransitionProblemDto {
  @ApiProperty({ enum: [...PROBLEM_STATUSES] })
  @IsIn(PROBLEM_STATUSES)
  toStatus!: ProblemStatus;

  @ApiPropertyOptional({ description: "Why the status changed (recorded on the audit event)." })
  @IsOptional()
  @IsString()
  @Length(1, 1000)
  reason?: string;
}
