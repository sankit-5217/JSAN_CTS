import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDate,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from "class-validator";

// `priority` is intentionally not editable — same "don't silently rewrite
// identity" precedent as UpdateCiDto. A policy that should apply to a
// different priority is a new versioned policy (effectiveFrom-dated), not
// a mutation of an existing one that instances may already reference.
export class UpdateSlaPolicyDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(2, 128)
  name?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  ackTargetMinutes?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  resolveTargetMinutes?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  usesBusinessCalendar?: boolean;

  @ApiProperty({ type: [Number], required: false })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(99, { each: true })
  escalationThresholdsPercent?: number[];

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  pausesOnPendingVendor?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  pausesOnPendingCustomer?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  effectiveTo?: Date;

  @ApiProperty({ required: false, description: "Deactivate a policy without deleting it" })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
