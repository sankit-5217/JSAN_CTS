import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import type { HealthSnapshotPayload } from "@cts-dc-opsdesk/shared-types";
import { Type } from "class-transformer";
import {
  Allow,
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  Length,
  ValidateNested,
} from "class-validator";
import { HEALTH_SNAPSHOT_SOURCES, HEALTH_STATES, POWER_STATES } from "../monitoring.constants";

/**
 * One normalized hardware health snapshot from a hardware adapter (via the site
 * collector). Shape is `HealthSnapshotPayload` from `@cts-dc-opsdesk/shared-types`
 * (`implements` keeps it in sync). Nested arrays/objects are the adapters' own
 * well-typed, well-tested output — validated shallowly here.
 */
export class HealthSnapshotDto implements HealthSnapshotPayload {
  @ApiProperty({ example: "SITE01-R01-SRV-040" })
  @IsString()
  @Length(1, 200)
  ciCode!: string;

  @ApiProperty({ enum: [...HEALTH_SNAPSHOT_SOURCES] })
  @IsIn(HEALTH_SNAPSHOT_SOURCES)
  source!: HealthSnapshotPayload["source"];

  @ApiProperty({ enum: [...HEALTH_STATES] })
  @IsIn(HEALTH_STATES)
  overallHealth!: HealthSnapshotPayload["overallHealth"];

  @ApiProperty({ enum: [...POWER_STATES] })
  @IsIn(POWER_STATES)
  powerState!: HealthSnapshotPayload["powerState"];

  @ApiProperty({ description: "ISO-8601 UTC; when the collector read the endpoint" })
  @IsISO8601()
  observedAt!: string;

  @ApiProperty({ type: [Object], description: "Components whose health is not HEALTHY" })
  @IsArray()
  degraded!: HealthSnapshotPayload["degraded"];

  @ApiProperty({ type: [Object] })
  @IsArray()
  predictiveFailures!: HealthSnapshotPayload["predictiveFailures"];

  @ApiProperty({ type: Object })
  @IsObject()
  summary!: HealthSnapshotPayload["summary"];

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  firmware?: HealthSnapshotPayload["firmware"];

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @Allow()
  attributes?: HealthSnapshotPayload["attributes"];
}

/** Batch envelope for `POST /monitoring/health-snapshots` (one collector poll). */
export class HealthSnapshotBatchDto {
  @ApiProperty({ type: [HealthSnapshotDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => HealthSnapshotDto)
  snapshots!: HealthSnapshotDto[];
}
