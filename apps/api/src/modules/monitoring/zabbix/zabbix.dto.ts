import { ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from "class-validator";

const URL_OPTIONS = { protocols: ["http", "https"], require_tld: false, require_protocol: true };

export class UpdateZabbixSettingsDto {
  @ApiPropertyOptional({ example: "http://127.0.0.1/zabbix/api_jsonrpc.php" })
  @IsOptional()
  @IsUrl(URL_OPTIONS, { message: "apiUrl must be an http(s) URL" })
  @MaxLength(500)
  apiUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({ minimum: 1000, maximum: 60000, example: 10000 })
  @IsOptional()
  @IsInt()
  @Min(1000)
  @Max(60000)
  requestTimeoutMs?: number;

  @ApiPropertyOptional({
    description: "New Zabbix API token. Write-only: omit to keep the current one.",
  })
  @IsOptional()
  @IsString()
  @Length(8, 512)
  apiToken?: string;

  @ApiPropertyOptional({ description: "true removes the stored token" })
  @IsOptional()
  @IsBoolean()
  clearToken?: boolean;
}

/** Optional overrides so an admin can test values before saving them. */
export class TestZabbixConnectionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl(URL_OPTIONS, { message: "apiUrl must be an http(s) URL" })
  @MaxLength(500)
  apiUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(8, 512)
  apiToken?: string;
}

export class ListZabbixProblemsQueryDto {
  @ApiPropertyOptional({ description: "Minimum Zabbix severity 0..5", example: 2 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(5)
  minSeverity?: number;

  @ApiPropertyOptional({ description: "Only problems on this Zabbix host id" })
  @IsOptional()
  @Matches(/^\d{1,20}$/, { message: "hostId must be a Zabbix id" })
  hostId?: string;
}

export class ZabbixHistoryQueryDto {
  @ApiPropertyOptional({ description: "Unix seconds; default: 6 hours ago" })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  from?: number;

  @ApiPropertyOptional({ description: "Unix seconds; default: now" })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  to?: number;
}

export class AcknowledgeZabbixProblemDto {
  @ApiPropertyOptional({ example: "Engineer on the way" })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  message?: string;
}
