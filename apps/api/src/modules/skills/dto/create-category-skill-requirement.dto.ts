import { ApiProperty } from "@nestjs/swagger";
import { IsString, IsUUID, MaxLength, MinLength } from "class-validator";

export class CreateCategorySkillRequirementDto {
  @ApiProperty({ example: "DATABASE" })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  category!: string;

  @ApiProperty({ format: "uuid" })
  @IsUUID()
  skillId!: string;
}
