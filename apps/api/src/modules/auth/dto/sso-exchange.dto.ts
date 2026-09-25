import { ApiProperty } from "@nestjs/swagger";
import { IsString, Length } from "class-validator";

export class SsoExchangeDto {
  @ApiProperty({ description: "Single-use code from the /auth/oidc/callback redirect" })
  @IsString()
  @Length(20, 200)
  code!: string;
}
