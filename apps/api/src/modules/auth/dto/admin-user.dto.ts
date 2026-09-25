import { ApiProperty } from "@nestjs/swagger";
import { UserRole } from "@prisma/client";
import { Transform } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsEmail,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
} from "class-validator";

const trim = ({ value }: { value: unknown }) => (typeof value === "string" ? value.trim() : value);
const normalizeEmail = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim().toLowerCase() : value;

export class CreateAdminUserDto {
  @ApiProperty({
    example: "person@jsan.example",
    description: "Must match the email the SSO provider sends",
  })
  @Transform(normalizeEmail)
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({ example: "Priya Sharma" })
  @Transform(trim)
  @IsString()
  @Length(1, 120)
  displayName!: string;

  @ApiProperty({ enum: UserRole })
  @IsEnum(UserRole)
  role!: UserRole;

  @ApiProperty({
    type: [String],
    required: false,
    description: "Site grants; ignored in effect for all-sites roles",
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(500)
  @IsUUID("all", { each: true })
  siteIds?: string[];
}

export class UpdateAdminUserDto {
  @ApiProperty({
    required: false,
    description: "Only editable until the user's first SSO login links them",
  })
  @IsOptional()
  @Transform(normalizeEmail)
  @IsEmail()
  @MaxLength(254)
  email?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 120)
  displayName?: string;

  @ApiProperty({ enum: UserRole, required: false })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;
}

export class SetUserSitesDto {
  @ApiProperty({ type: [String], description: "The complete set of granted site ids" })
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(500)
  @IsUUID("all", { each: true })
  siteIds!: string[];
}

export class ListAdminUsersQueryDto {
  @ApiProperty({ required: false, description: "Matches display name or email" })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiProperty({ enum: UserRole, required: false })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @ApiProperty({ enum: ["active", "inactive", "all"], required: false, default: "all" })
  @IsOptional()
  @IsIn(["active", "inactive", "all"])
  status?: "active" | "inactive" | "all";
}
