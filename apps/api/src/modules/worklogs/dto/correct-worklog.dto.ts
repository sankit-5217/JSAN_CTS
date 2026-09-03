import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { WorklogActivityType } from "@prisma/client";
import { IsBoolean, IsDate, IsEnum, IsOptional, IsString, Length } from "class-validator";

// Corrections, not free edits — every field is optional except editReason,
// which spec §10.7 makes mandatory: "edit_reason: Mandatory if authorized
// user corrects a submitted worklog."
export class CorrectWorklogDto {
  @ApiProperty({ enum: WorklogActivityType, required: false })
  @IsOptional()
  @IsEnum(WorklogActivityType)
  activityType?: WorklogActivityType;

  @ApiProperty({ required: false })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  startedAt?: Date;

  @ApiProperty({ required: false })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  endedAt?: Date;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(1, 2000)
  notes?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  billable?: boolean;

  @ApiProperty({ description: "Why this correction is being made — mandatory" })
  @IsString()
  @Length(2, 512)
  editReason!: string;
}
