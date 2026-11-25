import { ApiProperty } from "@nestjs/swagger";
import { IsIn, IsOptional, IsString, Length } from "class-validator";

export const CUSTOMER_FEEDBACK_OUTCOMES = ["FIXED", "NOT_FIXED"] as const;
export type CustomerFeedbackOutcome = (typeof CUSTOMER_FEEDBACK_OUTCOMES)[number];

/** A customer's answer to "is this fixed?" on a resolved ticket. */
export class CustomerFeedbackDto {
  @ApiProperty({ enum: CUSTOMER_FEEDBACK_OUTCOMES })
  @IsIn(CUSTOMER_FEEDBACK_OUTCOMES)
  outcome!: CustomerFeedbackOutcome;

  @ApiProperty({
    required: false,
    description: "Required when NOT_FIXED: what's still wrong.",
    example: "The fan alarm came back this morning.",
  })
  @IsOptional()
  @IsString()
  @Length(1, 4000)
  comment?: string;
}
