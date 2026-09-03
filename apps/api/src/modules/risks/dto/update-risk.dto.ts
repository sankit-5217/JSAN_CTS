import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsInt, IsISO8601, IsOptional, IsString, IsUUID, Length, Max, Min } from "class-validator";
import { RISK_LEVEL_MAX, RISK_LEVEL_MIN } from "../risks.constants";

/**
 * Register edits only. `status` changes go through `POST /risks/:id/status`.
 * Changing `likelihood` or `impact` re-computes `score` backend-side.
 */
export class UpdateRiskDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(3, 2000)
  description?: string;

  @ApiPropertyOptional({ minimum: RISK_LEVEL_MIN, maximum: RISK_LEVEL_MAX })
  @IsOptional()
  @IsInt()
  @Min(RISK_LEVEL_MIN)
  @Max(RISK_LEVEL_MAX)
  likelihood?: number;

  @ApiPropertyOptional({ minimum: RISK_LEVEL_MIN, maximum: RISK_LEVEL_MAX })
  @IsOptional()
  @IsInt()
  @Min(RISK_LEVEL_MIN)
  @Max(RISK_LEVEL_MAX)
  impact?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(3, 4000)
  mitigation?: string;

  @ApiPropertyOptional({ format: "uuid" })
  @IsOptional()
  @IsUUID()
  ownerId?: string;

  @ApiPropertyOptional({ format: "uuid" })
  @IsOptional()
  @IsUUID()
  siteId?: string;

  @ApiPropertyOptional({ description: "ISO-8601 UTC" })
  @IsOptional()
  @IsISO8601()
  dueDate?: string;
}
