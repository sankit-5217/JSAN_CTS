import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsISO8601, IsOptional, IsString, Length } from "class-validator";

/**
 * Plan / window edits are only accepted while the change has not started
 * (PENDING_APPROVAL or SCHEDULED). `outcome` records completion / the emergency
 * post-implementation review and is accepted once the window has begun.
 */
export class UpdateChangeDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(3, 500)
  reason?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(3, 4000)
  implementationPlan?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(3, 4000)
  rollbackPlan?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(3, 1000)
  risk?: string;

  @ApiPropertyOptional({ description: "ISO-8601 UTC" })
  @IsOptional()
  @IsISO8601()
  windowStart?: string;

  @ApiPropertyOptional({ description: "ISO-8601 UTC; must be after windowStart" })
  @IsOptional()
  @IsISO8601()
  windowEnd?: string;

  @ApiPropertyOptional({ description: "Completion / post-implementation review notes" })
  @IsOptional()
  @IsString()
  @Length(3, 4000)
  outcome?: string;
}
