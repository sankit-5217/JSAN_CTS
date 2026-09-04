import { ApiProperty } from "@nestjs/swagger";
import { Priority } from "@prisma/client";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDate,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from "class-validator";

/** Config over hard-code (CLAUDE.md, spec §10.8) — never a code constant. */
export class CreateSlaPolicyDto {
  @ApiProperty({ example: "P1 — Critical (24x7)" })
  @IsString()
  @Length(2, 128)
  name!: string;

  @ApiProperty({ enum: Priority })
  @IsEnum(Priority)
  priority!: Priority;

  @ApiProperty({ example: 15, description: "Acknowledgement target, minutes" })
  @IsInt()
  @Min(1)
  ackTargetMinutes!: number;

  @ApiProperty({ example: 240, description: "Resolution target, minutes" })
  @IsInt()
  @Min(1)
  resolveTargetMinutes!: number;

  @ApiProperty({
    required: false,
    default: false,
    description: "true = business-hours calendar clock; false = 24x7 wall clock",
  })
  @IsOptional()
  @IsBoolean()
  usesBusinessCalendar?: boolean;

  @ApiProperty({
    type: [Number],
    required: false,
    default: [50, 75, 90],
    description: "Escalation notify thresholds, percent of target elapsed (breach = 100 always fires)",
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(99, { each: true })
  escalationThresholdsPercent?: number[];

  @ApiProperty({ required: false, default: true })
  @IsOptional()
  @IsBoolean()
  pausesOnPendingVendor?: boolean;

  @ApiProperty({ required: false, default: true })
  @IsOptional()
  @IsBoolean()
  pausesOnPendingCustomer?: boolean;

  @ApiProperty()
  @Type(() => Date)
  @IsDate()
  effectiveFrom!: Date;

  @ApiProperty({ required: false })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  effectiveTo?: Date;

  @ApiProperty({ required: false, default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
