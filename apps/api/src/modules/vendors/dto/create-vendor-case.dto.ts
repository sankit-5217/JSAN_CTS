import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsBoolean, IsIn, IsOptional, IsString, IsUUID, Length } from "class-validator";
import { WARRANTY_STATUSES } from "../vendors.constants";
import type { WarrantyStatus } from "../vendors.constants";

export class CreateVendorCaseDto {
  @ApiProperty({ example: "SR1069284531", description: "The vendor's own case / ticket reference" })
  @IsString()
  @Length(1, 128)
  vendorCaseNo!: string;

  @ApiProperty({ format: "uuid" })
  @IsUUID()
  vendorId!: string;

  @ApiPropertyOptional({ format: "uuid", description: "Incident this case supports" })
  @IsOptional()
  @IsUUID()
  linkedIncidentId?: string;

  @ApiPropertyOptional({ format: "uuid", description: "CI the faulty part belongs to" })
  @IsOptional()
  @IsUUID()
  ciId?: string;

  @ApiPropertyOptional({ enum: [...WARRANTY_STATUSES], default: "UNKNOWN" })
  @IsOptional()
  @IsIn(WARRANTY_STATUSES)
  warrantyStatus?: WarrantyStatus;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  rmaRequired?: boolean;

  @ApiPropertyOptional({
    example: "PowerEdge 800W PSU",
    description: "Replacement part identifier",
  })
  @IsOptional()
  @IsString()
  @Length(1, 256)
  replacementPart?: string;
}
