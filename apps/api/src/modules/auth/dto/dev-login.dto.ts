import { ApiProperty } from "@nestjs/swagger";
import { IsEmail } from "class-validator";

export class DevLoginDto {
  @ApiProperty({ example: "admin@example.com", description: "Must match a seeded, active user" })
  @IsEmail()
  email!: string;
}
