import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import type { SnmpTrap, SnmpTrapVarbind } from "@cts-dc-opsdesk/snmp-adapter";
import { Type } from "class-transformer";
import {
  Allow,
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  ValidateNested,
} from "class-validator";

/** One decoded varbind (OID -> value) from a trap PDU. */
export class SnmpTrapVarbindDto implements SnmpTrapVarbind {
  @ApiProperty({ example: "1.3.6.1.2.1.2.2.1.1.3" })
  @IsString()
  @Length(1, 300)
  oid!: string;

  @ApiPropertyOptional({ example: "ifIndex" })
  @IsOptional()
  @IsString()
  name?: string;

  /** string | number | boolean | null — not constrained, the adapter coerces. */
  @ApiPropertyOptional()
  @Allow()
  value!: string | number | boolean | null;

  @ApiPropertyOptional({ example: "Integer" })
  @IsOptional()
  @IsString()
  type?: string;
}

/** Raw SNMPv1 trap fields, used to synthesise the trap OID (RFC 3584). */
export class SnmpV1Dto {
  @ApiPropertyOptional({ example: "1.3.6.1.4.1.318" })
  @IsOptional()
  @IsString()
  enterprise?: string;

  @ApiPropertyOptional({ minimum: 0, maximum: 6 })
  @IsOptional()
  @IsInt()
  genericTrap?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  specificTrap?: number;
}

/**
 * A parsed SNMP trap. Shape is the contract from `@cts-dc-opsdesk/snmp-adapter`;
 * `implements` keeps this DTO in sync. Normalization + dedup happen in the
 * service via the adapter, not here. The site collector resolves the source
 * address to `ciCode` before posting.
 */
export class SnmpTrapDto implements SnmpTrap {
  // No min-length: a structurally-valid trap with a blank/unresolved ciCode is
  // rejected per-trap by the adapter (SnmpNormalizationError), so one bad trap
  // doesn't 400 the whole batch — same contract as the Zabbix source route.
  @ApiProperty({ example: "SITE01-R03-SW-002" })
  @IsString()
  @MaxLength(200)
  ciCode!: string;

  @ApiPropertyOptional({ example: "SITE01" })
  @IsOptional()
  @IsString()
  @Length(1, 50)
  siteCode?: string;

  @ApiPropertyOptional({ example: "1.3.6.1.6.3.1.1.5.3", description: "snmpTrapOID.0" })
  @IsOptional()
  @IsString()
  @Length(1, 300)
  trapOid?: string;

  @ApiPropertyOptional({ example: "linkDown" })
  @IsOptional()
  @IsString()
  trapName?: string;

  @ApiProperty({ example: "10.20.3.2" })
  @IsString()
  @MaxLength(100)
  agentAddress!: string;

  @ApiPropertyOptional({ description: "sysUpTime.0 in hundredths of a second" })
  @IsOptional()
  @IsInt()
  sysUpTimeTicks?: number;

  @ApiPropertyOptional({ description: "ISO-8601; when the collector received the trap" })
  @IsOptional()
  @IsString()
  receivedAt?: string;

  @ApiPropertyOptional({ enum: ["v1", "v2c", "v3"] })
  @IsOptional()
  @IsIn(["v1", "v2c", "v3"])
  version?: string;

  @ApiPropertyOptional({ type: SnmpV1Dto })
  @IsOptional()
  @ValidateNested()
  @Type(() => SnmpV1Dto)
  v1?: SnmpV1Dto;

  @ApiPropertyOptional({ type: [SnmpTrapVarbindDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SnmpTrapVarbindDto)
  varbinds?: SnmpTrapVarbindDto[];

  @ApiPropertyOptional({
    enum: ["CRITICAL", "HIGH", "WARNING", "INFO"],
    description: "Collector override from vendor-MIB knowledge",
  })
  @IsOptional()
  @IsIn(["CRITICAL", "HIGH", "WARNING", "INFO"])
  severity?: "CRITICAL" | "HIGH" | "WARNING" | "INFO";

  @ApiPropertyOptional({ description: "Collector override: this is a 'clear' trap -> RECOVERED" })
  @IsOptional()
  @IsBoolean()
  clears?: boolean;
}

/** Batch envelope for `POST /alerts/sources/snmp`. */
export class SnmpTrapBatchDto {
  @ApiProperty({ type: [SnmpTrapDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => SnmpTrapDto)
  traps!: SnmpTrapDto[];
}
