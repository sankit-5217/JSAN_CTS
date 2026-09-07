import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsInt, IsOptional, Max, Min } from "class-validator";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

// Pagination on every list endpoint is a hard rule (spec §14.1) — matches
// CmdbService's ListCisQueryDto pattern.
export class ListSitesQueryDto {
  @ApiProperty({ required: false, default: DEFAULT_LIMIT })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_LIMIT)
  limit?: number = DEFAULT_LIMIT;

  @ApiProperty({ required: false, default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number = 0;
}
