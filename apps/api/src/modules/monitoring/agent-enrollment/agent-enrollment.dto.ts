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

/** Most machines one enrollment link may enroll. */
export const MAX_MACHINES_PER_LINK = 500;

export class CreateAgentEnrollmentDto {
  @ApiProperty({ description: "Site the enrolled machines belong to" })
  @IsUUID()
  siteId!: string;

  @ApiPropertyOptional({ example: "Acme Pune servers, Oct 2026" })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  label?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 30, default: 3 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(30)
  expiresInDays?: number;

  @ApiProperty({
    minimum: 1,
    maximum: MAX_MACHINES_PER_LINK,
    description:
      "How many machines this link may enroll (re-runs on an enrolled machine don't count)",
  })
  @IsInt()
  @Min(1)
  @Max(MAX_MACHINES_PER_LINK)
  maxMachines!: number;

  @ApiPropertyOptional({
    example: "CHG0012345",
    description: "The client's change / CAB reference, recorded with every enrollment",
  })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  changeReference?: string;
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

  @ApiPropertyOptional({
    example: "7XK2M93",
    description: "Hardware serial / service tag, to match the machine to its CMDB record",
  })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9 ._:/-]{0,64}$/, {
    message: "serial may only use letters, digits, spaces and . _ : / - (max 64)",
  })
  serial?: string;
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
