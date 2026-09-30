import { ApiProperty } from "@nestjs/swagger";
import { IsISO8601 } from "class-validator";

// Deliberately has no approverId field — the reviewer is always the
// authenticated caller (never client-suppliable), so the "owner cannot
// self-approve" rule can't be bypassed by just naming someone else.
export class ApproveArticleDto {
  @ApiProperty({
    description: "ISO-8601 UTC; next review date. Must be in the future.",
    example: "2027-03-01T00:00:00.000Z",
  })
  @IsISO8601()
  reviewDueAt!: string;
}
