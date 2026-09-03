import { ApiProperty } from "@nestjs/swagger";
import { CiType, Criticality, LifecycleStatus, ManagedBy } from "@prisma/client";
import { IsEnum, IsObject, IsOptional, IsString, IsUUID, Length } from "class-validator";

export class CreateCiDto {
  @ApiProperty({ example: "SITE01-R01-SRV-038", description: "Stable human-readable CI code" })
  @IsString()
  @Length(2, 64)
  ciCode!: string;

  @ApiProperty({ description: "Owning site's UUID" })
  @IsUUID()
  siteId!: string;

  @ApiProperty({ required: false, description: "Rack this CI is mounted in, if any" })
  @IsOptional()
  @IsUUID()
  rackId?: string;

  @ApiProperty({ enum: CiType })
  @IsEnum(CiType)
  ciType!: CiType;

  @ApiProperty({ example: "SITE01 Rack01 Server038" })
  @IsString()
  @Length(2, 128)
  name!: string;

  @ApiProperty({ required: false, example: "Dell" })
  @IsOptional()
  @IsString()
  manufacturer?: string;

  @ApiProperty({ required: false, example: "PowerEdge R750" })
  @IsOptional()
  @IsString()
  model?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  serialOrServiceTag?: string;

  // Access-restricted — spec §9.1: "never expose to customer viewer". Not
  // yet field-redacted per-role in API responses; see cmdb.service.ts note.
  @ApiProperty({ required: false, description: "iDRAC/iLO/management IP — access-restricted" })
  @IsOptional()
  @IsString()
  managementAddress?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  ownerGroupId?: string;

  @ApiProperty({ enum: ManagedBy })
  @IsEnum(ManagedBy)
  managedBy!: ManagedBy;

  @ApiProperty({ enum: Criticality })
  @IsEnum(Criticality)
  criticality!: Criticality;

  @ApiProperty({ enum: LifecycleStatus, required: false, default: LifecycleStatus.ACTIVE })
  @IsOptional()
  @IsEnum(LifecycleStatus)
  lifecycleStatus?: LifecycleStatus;

  @ApiProperty({ required: false, description: "Vendor-specific fields only (spec §9.1)" })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
