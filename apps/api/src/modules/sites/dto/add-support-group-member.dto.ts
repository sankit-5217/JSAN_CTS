import { ApiProperty } from "@nestjs/swagger";
import { IsUUID } from "class-validator";

export class AddSupportGroupMemberDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID()
  userId!: string;
}
