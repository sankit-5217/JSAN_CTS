import { ApiProperty } from "@nestjs/swagger";
import { ArrayMaxSize, IsArray, IsEmail } from "class-validator";

export const MAX_CC_EMAILS = 20;

/** PUT /incidents/:id/cc-list — the whole list, replaced. */
export class UpdateCcListDto {
  @ApiProperty({ type: [String], example: ["ops-lead@client.example"] })
  @IsArray()
  @ArrayMaxSize(MAX_CC_EMAILS)
  @IsEmail({}, { each: true })
  ccEmails!: string[];
}
