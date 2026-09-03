import { ApiProperty } from "@nestjs/swagger";
import { IsISO8601, IsUUID } from "class-validator";

export class ApproveArticleDto {
  @ApiProperty({
    format: "uuid",
    description: "Reviewer id. Must not be the article owner (separation of duties).",
  })
  @IsUUID()
  approverId!: string;

  @ApiProperty({
    description: "ISO-8601 UTC; next review date. Must be in the future.",
    example: "2027-03-01T00:00:00.000Z",
  })
  @IsISO8601()
  reviewDueAt!: string;
}
