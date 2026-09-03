import { ApiProperty } from "@nestjs/swagger";
import { IsOptional, IsString, IsUUID, Length } from "class-validator";

export class CreateRackDto {
  @ApiProperty()
  @IsUUID()
  siteId!: string;

  @ApiProperty({ example: "R01" })
  @IsString()
  @Length(1, 32)
  rackCode!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({ required: false, example: "Row 3, Aisle B" })
  @IsOptional()
  @IsString()
  location?: string;
}
