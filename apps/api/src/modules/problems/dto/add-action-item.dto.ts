import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsISO8601, IsOptional, IsString, IsUUID, Length } from "class-validator";

/** Add a corrective / preventive action item to a problem (spec §10.5). */
export class AddActionItemDto {
  @ApiProperty({ description: "What needs doing." })
  @IsString()
  @Length(3, 2000)
  description!: string;

  @ApiPropertyOptional({ description: "Who owns it (user id)." })
  @IsOptional()
  @IsUUID()
  assigneeUserId?: string;

  @ApiPropertyOptional({ description: "Due date (ISO-8601)." })
  @IsOptional()
  @IsISO8601()
  dueDate?: string;
}
