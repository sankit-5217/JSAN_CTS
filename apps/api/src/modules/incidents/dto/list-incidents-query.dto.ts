import { ApiProperty } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import { IncidentStatus, Priority } from "@prisma/client";
import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, Min } from "class-validator";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export class ListIncidentsQueryDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  siteId?: string;

  @ApiProperty({ enum: IncidentStatus, required: false })
  @IsOptional()
  @IsEnum(IncidentStatus)
  status?: IncidentStatus;

  @ApiProperty({ enum: Priority, required: false })
  @IsOptional()
  @IsEnum(Priority)
  priority?: Priority;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  ownerUserId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  ownerGroupId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  ciId?: string;

  @ApiProperty({ required: false, description: "Matches against incidentNo or shortDescription" })
  @IsOptional()
  @IsString()
  q?: string;

  @ApiProperty({
    required: false,
    description:
      "Open incidents with an SLA warning threshold already fired but not yet breached (spec §10.8)",
  })
  @IsOptional()
  // Querystring values arrive as strings — `@Type(() => Boolean)` would
  // coerce "false" to `true` (any non-empty string is truthy), so this is
  // an explicit string comparison instead. Absent stays undefined (not
  // coerced to false) so "not requested" and "explicitly false" differ.
  @Transform(({ value }) => (value === undefined ? undefined : value === true || value === "true"))
  @IsBoolean()
  slaAtRisk?: boolean;

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
