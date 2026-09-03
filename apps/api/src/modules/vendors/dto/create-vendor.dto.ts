import { ApiProperty } from "@nestjs/swagger";
import { IsIn, IsString, Length } from "class-validator";
import { VENDOR_TYPES } from "../vendors.constants";
import type { VendorType } from "../vendors.constants";

export class CreateVendorDto {
  @ApiProperty({ example: "Dell ProSupport" })
  @IsString()
  @Length(2, 128)
  name!: string;

  @ApiProperty({ enum: [...VENDOR_TYPES], example: "DELL" })
  @IsIn(VENDOR_TYPES)
  type!: VendorType;
}
