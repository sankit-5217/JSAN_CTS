import { ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsIn, IsInt, IsISO8601, IsOptional, Max, Min } from "class-validator";
import { CHANGE_STATUSES, CHANGE_TYPES } from "../changes.constants";
import type { ChangeStatus, ChangeType } from "../changes.constants";

export class QueryChangesDto {
  @ApiPropertyOptional({ enum: [...CHANGE_TYPES] })
  @IsOptional()
  @IsIn(CHANGE_TYPES)
  changeType?: ChangeType;

  @ApiPropertyOptional({ enum: [...CHANGE_STATUSES], description: "Derived status at 'now'" })
  @IsOptional()
  @IsIn(CHANGE_STATUSES)
  status?: ChangeStatus;

  @ApiPropertyOptional({
    description: "Return only changes whose window covers this instant (ISO-8601)",
  })
  @IsOptional()
  @IsISO8601()
  activeAt?: string;

  @ApiPropertyOptional({ default: 50, minimum: 1, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}
