import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IncidentStatus, Priority } from "@prisma/client";
import { IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, Min } from "class-validator";

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
