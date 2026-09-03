import { ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsUUID, Max, Min } from "class-validator";
import { RISK_SEVERITIES, RISK_STATUSES, RISK_VIEWS } from "../risks.constants";
import type { RiskSeverity, RiskStatus, RiskView } from "../risks.constants";

/** Read-side filters for `GET /risks`. */
export class QueryRisksDto {
  @ApiPropertyOptional({ enum: [...RISK_STATUSES] })
  @IsOptional()
  @IsIn(RISK_STATUSES)
  status?: RiskStatus;

  @ApiPropertyOptional({
    enum: [...RISK_SEVERITIES],
    description: "Derived band; filters on score.",
  })
  @IsOptional()
  @IsIn(RISK_SEVERITIES)
  severity?: RiskSeverity;

  @ApiPropertyOptional({ format: "uuid" })
  @IsOptional()
  @IsUUID()
  siteId?: string;

  @ApiPropertyOptional({ format: "uuid" })
  @IsOptional()
  @IsUUID()
  ownerId?: string;

  @ApiPropertyOptional({
    enum: [...RISK_VIEWS],
    description: "'overdue' = past due date, not CLOSED.",
  })
  @IsOptional()
  @IsIn(RISK_VIEWS)
  view?: RiskView;

  @ApiPropertyOptional({ default: 50, minimum: 1, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}
