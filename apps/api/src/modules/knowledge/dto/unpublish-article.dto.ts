import { ApiProperty } from "@nestjs/swagger";
import { IsString, Length } from "class-validator";

/** Pull an approved runbook back to DRAFT — e.g. it was found to be unsafe. */
export class UnpublishArticleDto {
  @ApiProperty({ example: "Step 4 powers down the wrong PSU on R650 — do not follow until fixed." })
  @IsString()
  @Length(3, 500)
  reason!: string;
}
