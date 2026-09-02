import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsISO8601, IsObject, IsOptional, IsString, Length } from "class-validator";
import { ALERT_SEVERITIES, ALERT_SOURCES, ALERT_STATES } from "../alerts.constants";
import type { AlertSeverity, AlertSource, AlertState } from "../alerts.constants";

/**
 * Normalized alert envelope (build spec §14.2) posted by monitoring adapters
 * and the site collector. Mirrors `NormalizedAlertPayload` in
 * `@cts-dc-opsdesk/shared-types`; kept as a validated class here so the
 * ingestion endpoint rejects malformed payloads at the edge.
 */
export class IngestAlertDto {
  @ApiProperty({
    example: "zbx-evt-90431",
    description: "Source-native event id. Ingestion is idempotent on (source, eventId).",
  })
  @IsString()
  @Length(1, 200)
  eventId!: string;

  @ApiProperty({ enum: [...ALERT_SOURCES], example: "ZABBIX" })
  @IsIn(ALERT_SOURCES)
  source!: AlertSource;

  @ApiProperty({
    example: "SITE01",
    description: "Site code. The alert is stored unresolved if the code is unknown.",
  })
  @IsString()
  @Length(1, 64)
  siteCode!: string;

  @ApiProperty({
    example: "SITE01-R01-SRV-038",
    description: "CI code. The alert is stored unresolved if the code is unknown.",
  })
  @IsString()
  @Length(1, 128)
  ciCode!: string;

  @ApiProperty({ example: "disk.predictive_failure" })
  @IsString()
  @Length(1, 128)
  alertType!: string;

  @ApiProperty({ enum: [...ALERT_SEVERITIES], example: "HIGH" })
  @IsIn(ALERT_SEVERITIES)
  severity!: AlertSeverity;

  @ApiPropertyOptional({
    example: "PhysicalDisk-2:1",
    description: "Sub-component identifier. Part of the dedup fingerprint.",
  })
  @IsOptional()
  @IsString()
  @Length(1, 128)
  componentKey?: string;

  @ApiProperty({
    example: "2026-09-02T10:15:00.000Z",
    description: "When the condition was observed at the source (ISO-8601, UTC).",
  })
  @IsISO8601()
  occurredAt!: string;

  @ApiProperty({ enum: [...ALERT_STATES], example: "OPEN" })
  @IsIn(ALERT_STATES)
  state!: AlertState;

  @ApiProperty({ example: "Predictive failure reported on physical disk 2:1" })
  @IsString()
  @Length(1, 500)
  summary!: string;

  @ApiPropertyOptional({
    description:
      "Source-specific structured context. Only a reference pointer is persisted — never raw telemetry (CLAUDE.md).",
    type: "object",
    additionalProperties: true,
  })
  @IsOptional()
  @IsObject()
  attributes?: Record<string, unknown>;
}
