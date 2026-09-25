import { ApiProperty } from "@nestjs/swagger";
import { IsString, Length } from "class-validator";

export class SocialExchangeDto {
  @ApiProperty({ description: "Single-use code from the /auth/social/:provider/callback redirect" })
  @IsString()
  @Length(20, 200)
  code!: string;
}
