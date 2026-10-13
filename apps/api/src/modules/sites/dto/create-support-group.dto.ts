import { ApiProperty } from "@nestjs/swagger";
import { IsBoolean, IsString, Length } from "class-validator";

export class CreateSupportGroupDto {
  @ApiProperty({ example: "NOC Tier 1" })
  @IsString()
  @Length(2, 128)
  name!: string;
}

export class SetClientSelectableDto {
  @ApiProperty({ description: "Offer this group as an Assignee Group on the client portal" })
  @IsBoolean()
  isClientSelectable!: boolean;
}
