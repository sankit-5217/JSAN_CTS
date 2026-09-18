import { ApiProperty } from "@nestjs/swagger";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
} from "class-validator";

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Config over hard-code (CLAUDE.md) — a recurring weekly duty window for
 *  one engineer at one site. `startTime`/`endTime` are "HH:MM" local to the
 *  site's own timezone; equal to a same-day 24h shift is rejected (use two
 *  shifts, or split at midnight) since it can't be told apart from "not
 *  configured". */
export class CreateShiftDto {
  @ApiProperty({ description: "Engineer this shift belongs to" })
  @IsUUID()
  userId!: string;

  @ApiProperty({ description: "Site this duty window covers" })
  @IsUUID()
  siteId!: string;

  @ApiProperty({ example: "Morning" })
  @IsString()
  @Length(1, 80)
  label!: string;

  @ApiProperty({
    type: [Number],
    example: [1, 2, 3, 4, 5],
    description: "0=Sun..6=Sat — the day(s) the shift starts on",
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(7)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  daysOfWeek!: number[];

  @ApiProperty({ example: "06:00", description: "HH:MM, site-local time" })
  @IsString()
  @Matches(TIME_PATTERN, { message: "startTime must be HH:MM (24h)" })
  startTime!: string;

  @ApiProperty({ example: "14:00", description: "HH:MM, site-local time" })
  @IsString()
  @Matches(TIME_PATTERN, { message: "endTime must be HH:MM (24h)" })
  endTime!: string;

  @ApiProperty({
    required: false,
    default: false,
    description: "true = this window is on-call/escalation coverage, not a normal working shift",
  })
  @IsOptional()
  @IsBoolean()
  isOnCall?: boolean;
}
