import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsDateString, IsInt, IsOptional, IsString, IsUUID, Max, Min } from "class-validator";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

// Pagination on every list endpoint is a hard rule (spec §14.1) — matches
// CmdbService's ListCisQueryDto pattern.
export class ListAuditEventsQueryDto {
  @ApiProperty({ required: false, description: "e.g. Incident, ConfigurationItem, SlaPolicy" })
  @IsOptional()
  @IsString()
  entityType?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  entityId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  actorId?: string;

  @ApiProperty({ required: false, description: "e.g. CREATE, UPDATE, TRANSITION" })
  @IsOptional()
  @IsString()
  action?: string;

  @ApiProperty({ required: false, description: "ISO 8601 -- events at/after this instant" })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiProperty({ required: false, description: "ISO 8601 -- events at/before this instant" })
  @IsOptional()
  @IsDateString()
  to?: string;

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
