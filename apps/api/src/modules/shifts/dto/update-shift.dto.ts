import { ApiProperty } from "@nestjs/swagger";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from "class-validator";

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

// userId/siteId are intentionally not editable — same "don't silently
// rewrite identity" precedent as UpdateSlaPolicyDto's priority. A shift
// that should belong to a different engineer or site is a new shift, not
// a mutation of one that history (and the live roster) already reflects.
export class UpdateShiftDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(1, 80)
  label?: string;

  @ApiProperty({ type: [Number], required: false, description: "0=Sun..6=Sat" })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(7)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  daysOfWeek?: number[];

  @ApiProperty({ required: false, description: "HH:MM, site-local time" })
  @IsOptional()
  @IsString()
  @Matches(TIME_PATTERN, { message: "startTime must be HH:MM (24h)" })
  startTime?: string;

  @ApiProperty({ required: false, description: "HH:MM, site-local time" })
  @IsOptional()
  @IsString()
  @Matches(TIME_PATTERN, { message: "endTime must be HH:MM (24h)" })
  endTime?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  isOnCall?: boolean;

  @ApiProperty({ required: false, description: "Retire a shift without deleting it" })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
