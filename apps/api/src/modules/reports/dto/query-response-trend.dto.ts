import { ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsIn, IsOptional } from "class-validator";

export const RESPONSE_TREND_WINDOWS = [7, 30, 90] as const;
export type ResponseTrendWindow = (typeof RESPONSE_TREND_WINDOWS)[number];

export class QueryResponseTrendDto {
  @ApiPropertyOptional({ enum: RESPONSE_TREND_WINDOWS, default: 30 })
  @IsOptional()
  @Type(() => Number)
  @IsIn(RESPONSE_TREND_WINDOWS)
  windowDays?: ResponseTrendWindow;
}
