import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from "class-validator";

export class CreateAgentEnrollmentDto {
  @ApiProperty({ description: "Site the enrolled machines belong to" })
  @IsUUID()
  siteId!: string;

  @ApiPropertyOptional({ example: "Acme Pune servers, Oct 2026" })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  label?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 30, default: 7 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(30)
  expiresInDays?: number;
}

export class ListAgentEnrollmentsQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  siteId?: string;
}

/** Sent by the installer from the client's machine. */
export class RegisterAgentDto {
  @ApiProperty({ example: "web-01" })
  @IsString()
  @Matches(/^[A-Za-z0-9._-]{1,60}$/, {
    message: "hostname may only use letters, digits, '.', '_' and '-' (max 60)",
  })
  hostname!: string;

  @ApiProperty({ enum: ["linux", "windows"] })
  @IsIn(["linux", "windows"])
  os!: "linux" | "windows";

  @ApiPropertyOptional({ example: "Ubuntu 24.04.1 LTS" })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  osVersion?: string;

  @ApiProperty({ description: "SHA-256 prefix of the machine id (never the raw id)" })
  @IsString()
  @Matches(/^[a-f0-9]{32}$/, { message: "machineId must be 32 lowercase hex characters" })
  machineId!: string;

  @ApiPropertyOptional({ example: "10.0.0.10" })
  @IsOptional()
  @IsString()
  @Matches(/^$|^\d{1,3}(\.\d{1,3}){3}$/, { message: "address must be an IPv4 address" })
  address?: string;
}

/** The installer asking whether Zabbix sees its agent yet. */
export class AgentStatusDto {
  @ApiProperty({ example: "web-01" })
  @IsString()
  @Matches(/^[A-Za-z0-9._-]{1,60}$/, {
    message: "hostname may only use letters, digits, '.', '_' and '-' (max 60)",
  })
  hostname!: string;

  @ApiProperty()
  @IsString()
  @Matches(/^[a-f0-9]{32}$/, { message: "machineId must be 32 lowercase hex characters" })
  machineId!: string;
}
