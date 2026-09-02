import { ApiProperty } from "@nestjs/swagger";
import { IsString, Length } from "class-validator";

export class AddVendorCaseUpdateDto {
  @ApiProperty({ example: "Vendor confirmed dispatch; courier tracking 1Z999AA10123456784" })
  @IsString()
  @Length(1, 2000)
  note!: string;
}
