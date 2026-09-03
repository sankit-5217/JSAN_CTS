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
  Matches,
  Max,
  Min,
} from "class-validator";

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/; // "HH:MM", 24h

export class CreateSupportCalendarDto {
  @ApiProperty({ example: "Business Hours" })
  @IsString()
  name!: string;

  @ApiProperty({ example: "09:00", description: "24h HH:MM, site-local time" })
  @Matches(TIME_PATTERN, { message: "businessStart must be HH:MM (24h)" })
  businessStart!: string;

  @ApiProperty({ example: "18:00", description: "24h HH:MM, site-local time" })
  @Matches(TIME_PATTERN, { message: "businessEnd must be HH:MM (24h)" })
  businessEnd!: string;

  @ApiProperty({
    type: [Number],
    example: [1, 2, 3, 4, 5],
    description: "0=Sun .. 6=Sat",
  })
  @IsArray()
  @ArrayMaxSize(7)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  workdays!: number[];

  @ApiProperty({ type: [String], required: false, example: ["2026-01-26"] })
  @IsOptional()
  @IsArray()
  @Type(() => Date)
  @IsDate({ each: true })
  holidays?: Date[];

  @ApiProperty({ required: false, default: false })
  @IsOptional()
  @IsBoolean()
  is247?: boolean;
}
