import { ApiPropertyOptional } from "@nestjs/swagger";
import {
  ArrayUnique,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
} from "class-validator";
import { ALERT_SEVERITIES } from "../alerts.constants";
import type { AlertSeverity } from "../alerts.constants";

/**
 * Patch an ingestion policy row. Every field optional; only what's sent changes.
 * Send `siteId` / `alertType` as `null` to widen a scoped rule back to global.
 */
export class UpdateAlertRuleDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ format: "uuid", nullable: true })
  @IsOptional()
  @IsUUID()
  siteId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @Length(1, 200)
  alertType?: string | null;

  @ApiPropertyOptional({ minimum: 1, maximum: 100 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  flappingThreshold?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 1440 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1440)
  flappingWindowMinutes?: number;

  @ApiPropertyOptional({ enum: [...ALERT_SEVERITIES], isArray: true })
  @IsOptional()
  @IsIn(ALERT_SEVERITIES, { each: true })
  @ArrayUnique()
  pagingSeverities?: AlertSeverity[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  autoCorrelateIncidents?: boolean;

  @ApiPropertyOptional({
    description: "Suppress auto-ticketing during a maintenance window (vs only labelling).",
  })
  @IsOptional()
  @IsBoolean()
  suppressAutoTicketDuringMaintenance?: boolean;

  @ApiPropertyOptional({ description: "Deactivate a rule without deleting it." })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
