import { ApiPropertyOptional } from "@nestjs/swagger";
import { Priority } from "@prisma/client";
import { IsEnum, IsISO8601, IsOptional, IsString, IsUUID, Length } from "class-validator";

/**
 * Edit problem fields (spec §10.5: symptoms, known error, root cause, corrective
 * / preventive action, owner, due date). Status is not editable here — use
 * POST /problems/:id/transition.
 */
export class UpdateProblemDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(3, 200)
  title?: string;

  @ApiPropertyOptional({ enum: Priority })
  @IsOptional()
  @IsEnum(Priority)
  priority?: Priority;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(3, 4000)
  symptoms?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 4000)
  knownError?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 4000)
  rootCause?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 4000)
  correctiveAction?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 4000)
  preventiveAction?: string;

  @ApiPropertyOptional({ description: "Problem owner (user id)." })
  @IsOptional()
  @IsUUID()
  ownerUserId?: string;

  @ApiPropertyOptional({ description: "RCA / action-plan due date (ISO-8601)." })
  @IsOptional()
  @IsISO8601()
  dueDate?: string;
}
