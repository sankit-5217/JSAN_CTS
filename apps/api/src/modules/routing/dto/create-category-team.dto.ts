import { ApiProperty } from "@nestjs/swagger";
import { IsString, IsUUID, MaxLength, MinLength } from "class-validator";

export class CreateCategoryTeamDto {
  @ApiProperty({ example: "STORAGE_FAILURE" })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  category!: string;

  @ApiProperty({ format: "uuid", description: "The support group that owns this category" })
  @IsUUID()
  groupId!: string;
}
