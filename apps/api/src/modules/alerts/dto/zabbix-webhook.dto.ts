import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import type { ZabbixWebhookEvent } from "@cts-dc-opsdesk/zabbix-adapter";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsObject,
  IsOptional,
  IsString,
  Length,
  ValidateNested,
} from "class-validator";

/**
 * One raw Zabbix webhook event. Shape is the media-type contract from
 * `@cts-dc-opsdesk/zabbix-adapter`; `implements` keeps this DTO in sync with it.
 * Normalization + dedup happen in the service via the adapter, not here.
 */
export class ZabbixWebhookEventDto implements ZabbixWebhookEvent {
  @ApiProperty({ example: "90431" })
  @IsString()
  @Length(1, 200)
  eventId!: string;

  @ApiProperty({ example: "1", description: '"1" problem, "0" recovery' })
  @IsString()
  eventValue!: string;

  @ApiPropertyOptional({ description: '"1" when this delivery is a problem update' })
  @IsOptional()
  @IsString()
  eventUpdateStatus?: string;

  @ApiPropertyOptional({ description: '"Yes" / "No"' })
  @IsOptional()
  @IsString()
  eventAckStatus?: string;

  @ApiProperty({ example: "Disk predictive failure on {HOST.NAME}" })
  @IsString()
  @Length(1, 500)
  name!: string;

  @ApiPropertyOptional({ description: 'Textual severity, "Not classified".."Disaster"' })
  @IsOptional()
  @IsString()
  severity?: string;

  @ApiPropertyOptional({ example: "4", description: "Numeric severity 0..5" })
  @IsOptional()
  @IsString()
  nseverity?: string;

  @ApiProperty({ example: "1756808100", description: "Unix epoch seconds" })
  @IsString()
  timestamp!: string;

  @ApiProperty({ example: "SITE01-R01-SRV-038" })
  @IsString()
  @Length(1, 200)
  host!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  hostName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  itemKey?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  triggerId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  opdata?: string;

  @ApiPropertyOptional({
    description: "Event tags; must include `site` and `ci`",
    type: "object",
    additionalProperties: { type: "string" },
  })
  @IsOptional()
  @IsObject()
  tags?: Record<string, string>;
}

/** Batch envelope for `POST /alerts/sources/zabbix`. */
export class ZabbixWebhookBatchDto {
  @ApiProperty({ type: [ZabbixWebhookEventDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => ZabbixWebhookEventDto)
  events!: ZabbixWebhookEventDto[];
}
