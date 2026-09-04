import { ApiPropertyOptional } from "@nestjs/swagger";
import { ArrayMaxSize, IsArray, IsOptional, IsUUID } from "class-validator";

export class WarrantyResyncDto {
  @ApiPropertyOptional({
    description:
      "Restrict the resync to these CI ids. Omit to sweep every CI that has a service tag.",
    type: [String],
    format: "uuid",
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsUUID("4", { each: true })
  ciIds?: string[];
}
