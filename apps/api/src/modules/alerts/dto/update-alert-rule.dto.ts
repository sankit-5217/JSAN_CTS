import { Priority } from "@prisma/client";
import { ApiPropertyOptional } from "@nestjs/swagger";
import {
  ArrayUnique,
  IsBoolean,
  IsEnum,
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

  @ApiPropertyOptional({
    description:
      "Severities that open a new incident when the CI has no open one (routing then offers it). " +
      "Send [] to turn auto-creation off.",
    enum: [...ALERT_SEVERITIES],
    isArray: true,
    default: ["CRITICAL"],
  })
  @IsOptional()
  @IsIn(ALERT_SEVERITIES, { each: true })
  @ArrayUnique()
  autoCreateSeverities?: AlertSeverity[];

  @ApiPropertyOptional({
    description:
      'Category for auto-created incidents, e.g. "STORAGE_FAILURE" (drives skill-based routing). ' +
      "Omit or null for OTHER.",
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @Length(0, 100)
  incidentCategory?: string | null;

  @ApiPropertyOptional({
    description: "Priority for auto-created incidents. Omit or null to derive it from severity.",
    enum: Priority,
    nullable: true,
  })
  @IsOptional()
  @IsEnum(Priority)
  incidentPriority?: Priority | null;

  @ApiPropertyOptional({ description: "Deactivate a rule without deleting it." })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
