import { ApiProperty } from "@nestjs/swagger";
import { IsBoolean, IsEmail, IsOptional, IsString, Length } from "class-validator";

export class CreateSiteContactDto {
  @ApiProperty({ example: "Priya Sharma" })
  @IsString()
  @Length(2, 128)
  name!: string;

  @ApiProperty({ example: "Site Manager", description: "Free-text role/title at the site" })
  @IsString()
  @Length(2, 64)
  role!: string;

  @ApiProperty({ required: false, example: "priya.sharma@example.com" })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiProperty({ required: false, example: "+91-98765-43210" })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiProperty({ required: false, default: false })
  @IsOptional()
  @IsBoolean()
  isOnCall?: boolean;
}
