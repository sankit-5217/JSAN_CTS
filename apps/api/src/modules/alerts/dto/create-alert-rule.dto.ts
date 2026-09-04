import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { ArrayUnique, IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, Min } from "class-validator";
import { ALERT_SEVERITIES } from "../alerts.constants";
import type { AlertSeverity } from "../alerts.constants";

/**
 * Create an ingestion policy row (spec §10.10). Anything omitted falls back to
 * the Prisma column default, so a minimal body just needs `name`.
 */
export class CreateAlertRuleDto {
  @ApiProperty({ description: "Human label, e.g. \"default\" or \"noisy-lab-sites\"." })
  @IsString()
  name!: string;

  @ApiPropertyOptional({
    description: "Same fingerprint seen this many times in the window flags flapping.",
    default: 3,
    minimum: 1,
    maximum: 100,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  flappingThreshold?: number;

  @ApiPropertyOptional({ default: 30, minimum: 1, maximum: 1440 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1440)
  flappingWindowMinutes?: number;

  @ApiPropertyOptional({
    description: "Severities that page the NOC roster on a brand-new alert.",
    enum: [...ALERT_SEVERITIES],
    isArray: true,
    default: ["CRITICAL"],
  })
  @IsOptional()
  @IsIn(ALERT_SEVERITIES, { each: true })
  @ArrayUnique()
  pagingSeverities?: AlertSeverity[];

  @ApiPropertyOptional({
    description: "Attach a live alert to an open incident on the same CI.",
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  autoCorrelateIncidents?: boolean;

  @ApiPropertyOptional({
    description: "Only the newest active row is applied; set false to retire one.",
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
