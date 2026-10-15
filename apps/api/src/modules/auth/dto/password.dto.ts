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

export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  @Length(1, 128)
  currentPassword!: string;

  @ApiProperty({ description: "At least 12 characters, different from the current one" })
  @IsString()
  @Length(1, 128)
  newPassword!: string;
}

export class AdminSetPasswordDto {
  @ApiProperty({
    description:
      "Starting password (at least 12 characters); the user must change it at first sign-in",
  })
  @IsString()
  @Length(1, 128)
  password!: string;
}
