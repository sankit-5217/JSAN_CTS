import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import type { AlertmanagerAlert, AlertmanagerWebhook } from "@cts-dc-opsdesk/prometheus-adapter";
import { Type } from "class-transformer";
import {
  IsArray,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from "class-validator";

const ALERT_STATUS = ["firing", "resolved"] as const;

export class AlertmanagerAlertDto implements AlertmanagerAlert {
  @ApiProperty({ enum: ALERT_STATUS })
  @IsIn(ALERT_STATUS)
  status!: "firing" | "resolved";

  @ApiProperty({ type: "object", additionalProperties: { type: "string" } })
  @IsObject()
  labels!: Record<string, string>;

  @ApiProperty({ type: "object", additionalProperties: { type: "string" } })
  @IsObject()
  annotations!: Record<string, string>;

  @ApiProperty({ example: "2025-09-02T10:15:00.000Z" })
  @IsString()
  startsAt!: string;

  @ApiProperty({ example: "0001-01-01T00:00:00Z" })
  @IsString()
  endsAt!: string;

  @ApiProperty({ description: "Alertmanager label-set fingerprint" })
  @IsString()
  fingerprint!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  generatorURL?: string;
}

/**
 * Alertmanager webhook payload (schema version 4). Only the fields OpsDesk uses
 * are typed; the route's pipe strips the rest rather than rejecting the delivery.
 */
export class AlertmanagerWebhookDto implements AlertmanagerWebhook {
  @ApiProperty({ example: "4" })
  @IsString()
  version!: string;

  @ApiProperty({ enum: ALERT_STATUS })
  @IsIn(ALERT_STATUS)
  status!: "firing" | "resolved";

  @ApiProperty({ type: [AlertmanagerAlertDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AlertmanagerAlertDto)
  alerts!: AlertmanagerAlertDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  groupKey?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  truncatedAlerts?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  receiver?: string;

  @ApiPropertyOptional({ type: "object", additionalProperties: { type: "string" } })
  @IsOptional()
  @IsObject()
  groupLabels?: Record<string, string>;

  @ApiPropertyOptional({ type: "object", additionalProperties: { type: "string" } })
  @IsOptional()
  @IsObject()
  commonLabels?: Record<string, string>;

  @ApiPropertyOptional({ type: "object", additionalProperties: { type: "string" } })
  @IsOptional()
  @IsObject()
  commonAnnotations?: Record<string, string>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  externalURL?: string;
}
