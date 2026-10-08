import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Priority } from "@prisma/client";
import {
  ArrayMaxSize,
  IsArray,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
} from "class-validator";
import { CATALOG_VALUE_PATTERN } from "./issue-catalog.dto";
import { MAX_CC_EMAILS } from "./update-cc-list.dto";

/**
 * The client portal's "Report an issue" template (one property per field on
 * the form). Every pick-list value is checked against the live issue
 * catalog (IssueReportingService) — the set of allowed values is DB
 * configuration, not this file.
 *
 * Not here on purpose: `status` (always NEW — state changes only ever go
 * through POST /incidents/:id/transition) and `reporter` (the caller's own
 * identity, taken from the JWT, never the body).
 */
export class CreateIncidentAsCustomerDto {
  @ApiProperty({ description: "Site the issue is at — must be one the caller has access to" })
  @IsUUID()
  siteId!: string;

  @ApiPropertyOptional({
    description: "Template the form was drafted from (recorded on the timeline)",
  })
  @IsOptional()
  @IsUUID()
  templateId?: string;

  @ApiProperty({ description: "ISSUE_TYPE catalog value", example: "HARDWARE_FAILURE" })
  @IsString()
  @Matches(CATALOG_VALUE_PATTERN)
  issueType!: string;

  @ApiProperty({ description: "Subject", example: "Server in Rack 3 is showing a red fault light" })
  @IsString()
  @Length(2, 256)
  subject!: string;

  @ApiPropertyOptional({ description: "Description (the template's drafted body, completed)" })
  @IsOptional()
  @IsString()
  @Length(1, 8000)
  description?: string;

  @ApiPropertyOptional({ enum: Priority, description: "Defaults to P3 when omitted" })
  @IsOptional()
  @IsEnum(Priority)
  priority?: Priority;

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
    description: "Assignee Group. Defaults to the support group flagged as default (Service Desk).",
  })
  @IsOptional()
  @IsUUID()
  ownerGroupId?: string;

  @ApiPropertyOptional({ description: "Assignee — must be a member of the assignee group" })
  @IsOptional()
  @IsUUID()
  ownerUserId?: string;

  @ApiPropertyOptional({ type: [String], description: "CC List" })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_CC_EMAILS)
  @IsEmail({}, { each: true })
  ccEmails?: string[];

  @ApiPropertyOptional({
    description: "Ref Bug ID: the ticket this duplicates or is blocked by",
    example: "INC-000123",
  })
  @IsOptional()
  @IsString()
  @Length(3, 32)
  refIncidentNo?: string;
}
