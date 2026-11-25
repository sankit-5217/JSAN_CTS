import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Priority } from "@prisma/client";
import {
  ArrayMaxSize,
  IsArray,
  IsEmail,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
} from "class-validator";
import { CATALOG_VALUE_PATTERN } from "./issue-catalog.dto";
import { MAX_CC_EMAILS } from "./update-cc-list.dto";

// Impact/urgency are plain strings in the schema (no Prisma enum exists for
// them yet) — validated here against spec §16's terms instead.
export const IMPACT_URGENCY_VALUES = ["HIGH", "MEDIUM", "LOW"] as const;

/**
 * The "Report an issue" template's classification fields, shared by the
 * staff create/update bodies and the customer report. Values are checked
 * against the live issue catalog in the service, not here.
 */
export class IncidentTemplateFieldsDto {
  @ApiPropertyOptional({ description: "Full description (the Subject is `shortDescription`)" })
  @IsOptional()
  @IsString()
  @Length(1, 8000)
  description?: string;

  @ApiPropertyOptional({ description: "ISSUE_TYPE catalog value" })
  @IsOptional()
  @IsString()
  @Matches(CATALOG_VALUE_PATTERN)
  issueType?: string;

  @ApiPropertyOptional({ description: "SEVERITY catalog value" })
  @IsOptional()
  @IsString()
  @Matches(CATALOG_VALUE_PATTERN)
  severity?: string;

  @ApiPropertyOptional({ description: "COMPONENT catalog value" })
  @IsOptional()
  @IsString()
  @Matches(CATALOG_VALUE_PATTERN)
  component?: string;

  @ApiPropertyOptional({ description: "SUB_COMPONENT catalog value, under `component`" })
  @IsOptional()
  @IsString()
  @Matches(CATALOG_VALUE_PATTERN)
  subComponent?: string;

  @ApiPropertyOptional({ description: "TOOL catalog value" })
  @IsOptional()
  @IsString()
  @Matches(CATALOG_VALUE_PATTERN)
  tool?: string;

  @ApiPropertyOptional({
    description: 'Ref Bug ID: INC-000123 (duplicate of / blocked by). On update, "" clears it.',
  })
  @IsOptional()
  @IsString()
  @Length(0, 32)
  refIncidentNo?: string;

  @ApiPropertyOptional({ type: [String], description: "CC List" })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_CC_EMAILS)
  @IsEmail({}, { each: true })
  ccEmails?: string[];
}

export class CreateIncidentDto extends IncidentTemplateFieldsDto {
  @ApiProperty({ description: "Site the incident is against" })
  @IsUUID()
  siteId!: string;

  @ApiProperty({ required: false, description: "Affected CI, when known" })
  @IsOptional()
  @IsUUID()
  ciId?: string;

  @ApiProperty({ example: "HARDWARE_FAILURE" })
  @IsString()
  @Length(2, 64)
  category!: string;

  @ApiProperty({ enum: IMPACT_URGENCY_VALUES })
  @IsIn(IMPACT_URGENCY_VALUES)
  impact!: string;

  @ApiProperty({ enum: IMPACT_URGENCY_VALUES })
  @IsIn(IMPACT_URGENCY_VALUES)
  urgency!: string;

  // Client-supplied for now — an impact x urgency auto-calculation belongs
  // to the SLA module (spec §10.8/§16), not here (see Sprint 4 plan, Decision 1).
  @ApiProperty({ enum: Priority })
  @IsEnum(Priority)
  priority!: Priority;

  @ApiProperty({ example: "SITE01-R01-SRV-001 unresponsive after power event" })
  @IsString()
  @Length(2, 256)
  shortDescription!: string;
}
