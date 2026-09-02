import { ApiProperty } from "@nestjs/swagger";
import { IsBoolean, IsOptional, IsString, Length } from "class-validator";

export class CreateSiteDto {
  @ApiProperty({ example: "SITE01", description: "Stable human-readable site code" })
  @IsString()
  @Length(2, 32)
  code!: string;

  @ApiProperty({ example: "Mumbai Data Center 1" })
  @IsString()
  @Length(2, 128)
  name!: string;

  @ApiProperty({ example: "Asia/Kolkata" })
  @IsString()
  timezone!: string;

  @ApiProperty({ required: false, example: false })
  @IsOptional()
  @IsBoolean()
  is247!: boolean;
}
