import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Priority } from "@prisma/client";
import { IsEnum, IsISO8601, IsOptional, IsString, IsUUID, Length } from "class-validator";

/** Open a problem record (spec §10.5). Symptoms are required; the RCA fields are filled in later. */
export class CreateProblemDto {
  @ApiProperty({ description: "Short problem title." })
  @IsString()
  @Length(3, 200)
  title!: string;

  @ApiProperty({ description: "Observed symptoms / what recurs." })
  @IsString()
  @Length(3, 4000)
  symptoms!: string;

  @ApiPropertyOptional({ enum: Priority })
  @IsOptional()
  @IsEnum(Priority)
  priority?: Priority;

  @ApiPropertyOptional({ description: "Documented workaround / known-error note." })
  @IsOptional()
  @IsString()
  @Length(1, 4000)
  knownError?: string;

  @ApiPropertyOptional({ description: "Problem owner (user id)." })
  @IsOptional()
  @IsUUID()
  ownerUserId?: string;

  @ApiPropertyOptional({ description: "RCA / action-plan due date (ISO-8601)." })
  @IsOptional()
  @IsISO8601()
  dueDate?: string;
}
