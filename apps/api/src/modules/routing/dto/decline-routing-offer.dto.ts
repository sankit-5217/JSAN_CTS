import { ApiProperty } from "@nestjs/swagger";
import { IsOptional, IsString, MaxLength } from "class-validator";

export class DeclineRoutingOfferDto {
  @ApiProperty({ required: false, maxLength: 500, description: "Why you can't take it (optional)" })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
