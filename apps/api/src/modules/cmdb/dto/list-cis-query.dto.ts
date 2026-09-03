import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { CiType, Criticality, LifecycleStatus, ManagedBy } from "@prisma/client";
import { IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, Min } from "class-validator";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

// Pagination on every list endpoint is a hard rule (spec §14.1) — this is
// the first CMDB list, built with it from the start. `sites.findAll`
// predates this and still lacks it; that's a known gap, not a pattern to
// copy (see TODO on SitesService.findAll).
export class ListCisQueryDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  siteId?: string;

  @ApiProperty({ enum: CiType, required: false })
  @IsOptional()
  @IsEnum(CiType)
  ciType?: CiType;

  @ApiProperty({ enum: Criticality, required: false })
  @IsOptional()
  @IsEnum(Criticality)
  criticality?: Criticality;

  @ApiProperty({ enum: ManagedBy, required: false })
  @IsOptional()
  @IsEnum(ManagedBy)
  managedBy?: ManagedBy;

  @ApiProperty({ enum: LifecycleStatus, required: false })
  @IsOptional()
  @IsEnum(LifecycleStatus)
  lifecycleStatus?: LifecycleStatus;

  @ApiProperty({ required: false, description: "Matches against ciCode or name" })
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
