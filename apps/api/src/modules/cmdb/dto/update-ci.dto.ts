import { ApiProperty } from "@nestjs/swagger";
import { Criticality, LifecycleStatus } from "@prisma/client";
import { IsEnum, IsObject, IsOptional, IsString, IsUUID, Length } from "class-validator";

// Identity fields (ciCode, siteId, ciType) are intentionally not editable
// here — if one of those was wrong, retire the CI and create a correct
// one rather than mutating identity (spec §13.1/§25: no hard delete,
// retire instead; the same "don't silently rewrite identity" spirit
// applies here).
export class UpdateCiDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  rackId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(2, 128)
  name?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  manufacturer?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  model?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  serialOrServiceTag?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  managementAddress?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  ownerGroupId?: string;

  @ApiProperty({ enum: Criticality, required: false })
  @IsOptional()
  @IsEnum(Criticality)
  criticality?: Criticality;

  @ApiProperty({
    enum: LifecycleStatus,
    required: false,
    description: "Set to RETIRED instead of deleting a CI",
  })
  @IsOptional()
  @IsEnum(LifecycleStatus)
  lifecycleStatus?: LifecycleStatus;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
