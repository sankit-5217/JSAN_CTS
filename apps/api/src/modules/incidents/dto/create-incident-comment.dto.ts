import { ApiProperty } from "@nestjs/swagger";
import { IsBoolean, IsOptional, IsString, Length } from "class-validator";

export class CreateIncidentCommentDto {
  @ApiProperty({ example: "Escalated to vendor for RMA." })
  @IsString()
  @Length(1, 4000)
  body!: string;

  // Default matches the schema default — internal engineer note unless
  // explicitly marked customer-visible (spec §19).
  @ApiProperty({ required: false, default: true })
  @IsOptional()
  @IsBoolean()
  isInternal?: boolean;
}
