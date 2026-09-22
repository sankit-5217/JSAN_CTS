import { ApiProperty } from "@nestjs/swagger";
import { IsUUID } from "class-validator";

export class AssignSkillDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID()
  userId!: string;
}
