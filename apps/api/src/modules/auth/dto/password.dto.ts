import { ApiProperty } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsEmail, IsString, Length, MaxLength } from "class-validator";

const normalizeEmail = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim().toLowerCase() : value;

export class PasswordLoginDto {
  @ApiProperty({ example: "admin@example.com" })
  @Transform(normalizeEmail)
  @IsEmail()
  @MaxLength(254)
  email!: string;

  // No policy check here — only on set. Upper bound stops hashing huge inputs.
  @ApiProperty()
  @IsString()
  @Length(1, 128)
  password!: string;
}

export class ForgotPasswordDto {
  @ApiProperty()
  @Transform(normalizeEmail)
  @IsEmail()
  @MaxLength(254)
  email!: string;
}

export class PasswordTokenDto {
  @ApiProperty({ description: "Token from the invite / reset link" })
  @IsString()
  @Length(20, 200)
  token!: string;
}

export class SetPasswordDto extends PasswordTokenDto {
  @ApiProperty({ description: "At least 12 characters" })
  @IsString()
  @Length(1, 128)
  password!: string;
}
