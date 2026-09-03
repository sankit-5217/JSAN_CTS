import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsBoolean, IsIn, IsISO8601, IsOptional, IsString, Length } from "class-validator";
import { DISPATCH_STATUSES, WARRANTY_STATUSES } from "../vendors.constants";
import type { DispatchStatus, WarrantyStatus } from "../vendors.constants";

export class UpdateVendorCaseDto {
  @ApiPropertyOptional({
    enum: [...DISPATCH_STATUSES],
    description: "Advances the RMA dispatch lifecycle; the transition is validated server-side",
  })
  @IsOptional()
  @IsIn(DISPATCH_STATUSES)
  dispatchStatus?: DispatchStatus;

  @ApiPropertyOptional({ example: "PowerEdge 800W PSU" })
  @IsOptional()
  @IsString()
  @Length(1, 256)
  replacementPart?: string;

  @ApiPropertyOptional({ enum: [...WARRANTY_STATUSES] })
  @IsOptional()
  @IsIn(WARRANTY_STATUSES)
  warrantyStatus?: WarrantyStatus;

  @ApiPropertyOptional({ description: "Vendor ETA for the part / fix (ISO-8601 UTC)" })
  @IsOptional()
  @IsISO8601()
  vendorEta?: string;

  @ApiPropertyOptional({ description: "Record that the vendor has acknowledged the case" })
  @IsOptional()
  @IsBoolean()
  acknowledged?: boolean;

  @ApiPropertyOptional({ description: "Close the case with this outcome" })
  @IsOptional()
  @IsString()
  @Length(1, 512)
  closeOutcome?: string;
}
