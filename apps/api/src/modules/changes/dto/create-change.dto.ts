import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
} from "class-validator";
import { CHANGE_TYPES } from "../changes.constants";
import type { ChangeType } from "../changes.constants";

export class CreateChangeDto {
  @ApiProperty({ enum: [...CHANGE_TYPES], example: "NORMAL" })
  @IsIn(CHANGE_TYPES)
  changeType!: ChangeType;

  @ApiProperty({ example: "Replace failed PSU in SITE01-R01-SRV-038" })
  @IsString()
  @Length(3, 500)
  reason!: string;

  @ApiProperty({ example: "Power down redundant PSU2, swap unit, verify redundancy restored" })
  @IsString()
  @Length(3, 4000)
  implementationPlan!: string;

  @ApiProperty({
    example: "Re-seat original PSU2; if unit dead, run on PSU1 only until next window",
  })
  @IsString()
  @Length(3, 4000)
  rollbackPlan!: string;

  @ApiProperty({ example: "Low - N+1 redundancy maintained throughout" })
  @IsString()
  @Length(3, 1000)
  risk!: string;

  @ApiProperty({ example: "2026-09-05T22:00:00.000Z", description: "ISO-8601 UTC" })
  @IsISO8601()
  windowStart!: string;

  @ApiProperty({
    example: "2026-09-05T23:00:00.000Z",
    description: "ISO-8601 UTC; must be after windowStart",
  })
  @IsISO8601()
  windowEnd!: string;

  @ApiPropertyOptional({
    type: [String],
    format: "uuid",
    description: "CIs this change affects. Omit / empty for a site-wide window.",
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID("4", { each: true })
  affectedCiIds?: string[];
}
