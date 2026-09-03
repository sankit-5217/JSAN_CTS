import { ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from "class-validator";
import { ALERT_SEVERITIES, ALERT_STATES } from "../alerts.constants";
import type { AlertSeverity, AlertState } from "../alerts.constants";

/** Read-side filters for `GET /alerts`. */
export class QueryAlertsDto {
  @ApiPropertyOptional({ enum: [...ALERT_STATES] })
  @IsOptional()
  @IsIn(ALERT_STATES)
  state?: AlertState;

  @ApiPropertyOptional({ enum: [...ALERT_SEVERITIES] })
  @IsOptional()
  @IsIn(ALERT_SEVERITIES)
  severity?: AlertSeverity;

  @ApiPropertyOptional({ description: "Exact dedup fingerprint to filter by." })
  @IsOptional()
  @IsString()
  fingerprint?: string;

  @ApiPropertyOptional({ description: "CI code; resolves to that CI's alerts." })
  @IsOptional()
  @IsString()
  ciCode?: string;

  @ApiPropertyOptional({ default: 50, minimum: 1, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}
