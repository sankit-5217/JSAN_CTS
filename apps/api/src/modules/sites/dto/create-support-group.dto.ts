import { ApiProperty } from "@nestjs/swagger";
import { IsString, Length } from "class-validator";

export class CreateSupportGroupDto {
  @ApiProperty({ example: "NOC Tier 1" })
  @IsString()
  @Length(2, 128)
  name!: string;
}
