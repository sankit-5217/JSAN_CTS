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
  ValidateIf,
} from "class-validator";
import { IMPACT_URGENCY_VALUES, IncidentTemplateFieldsDto } from "./create-incident.dto";
import { CATALOG_VALUE_PATTERN } from "./issue-catalog.dto";
import { MAX_CC_EMAILS } from "./update-cc-list.dto";

// Deliberately has no `status` field — status only ever changes through
// POST /incidents/:id/transition (CLAUDE.md: never let the frontend set
// incident.status directly). This isn't role-gated out, it's absent.
//
// Inherits the "Report an issue" template fields (description, issue type,
// severity, component/sub component, tool, ref bug id, cc list) so the
// desk can correct a reporter's classification on the ticket page.
export class UpdateIncidentDto extends IncidentTemplateFieldsDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(2, 256)
  shortDescription?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(2, 64)
  category?: string;

  @ApiProperty({ enum: IMPACT_URGENCY_VALUES, required: false })
  @IsOptional()
  @IsIn(IMPACT_URGENCY_VALUES)
  impact?: string;

  @ApiProperty({ enum: IMPACT_URGENCY_VALUES, required: false })
  @IsOptional()
  @IsIn(IMPACT_URGENCY_VALUES)
  urgency?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  ciId?: string;

  @ApiProperty({ required: false, description: "Assign to a support group" })
  @IsOptional()
  @IsUUID()
  ownerGroupId?: string;

  @ApiProperty({ required: false, description: "Assign to a specific engineer" })
  @IsOptional()
  @IsUUID()
  ownerUserId?: string;

  @ApiProperty({ enum: Priority, required: false, description: "Authorized override" })
  @IsOptional()
  @IsEnum(Priority)
  priority?: Priority;

  // Spec §16: "Authorized priority override requires a reason and generates
  // an audit event." Required exactly when priority is being changed.
  @ApiProperty({ required: false })
  @ValidateIf((o: UpdateIncidentDto) => o.priority !== undefined)
  @IsString()
  @Length(2, 256)
  priorityChangeReason?: string;
}

const CATALOG_VALUE_OR_EMPTY = new RegExp(`^(?:|${CATALOG_VALUE_PATTERN.source.slice(1, -1)})$`);

/**
 * PATCH /incidents/:id/report — the reporter editing their own ticket on
 * the client portal. The issue template's fields minus Description (frozen
 * once raised) and Status (staff only). For the optional pick-lists,
 * Assignee and Ref Bug ID, "" clears the value; an omitted field is left
 * as it is.
 */
export class UpdateCustomerReportDto {
  @ApiPropertyOptional({ description: "ISSUE_TYPE catalog value (the template)" })
  @IsOptional()
  @IsString()
  @Matches(CATALOG_VALUE_PATTERN)
  issueType?: string;

  @ApiPropertyOptional({ description: "Subject" })
  @IsOptional()
  @IsString()
  @Length(2, 256)
  subject?: string;

  @ApiPropertyOptional({ enum: Priority, description: "Re-targets the SLA when it changes" })
  @IsOptional()
  @IsEnum(Priority)
  priority?: Priority;

  @ApiPropertyOptional({ description: 'SEVERITY catalog value; "" clears it' })
  @IsOptional()
  @IsString()
  @Matches(CATALOG_VALUE_OR_EMPTY)
  severity?: string;

  @ApiPropertyOptional({ description: 'COMPONENT catalog value; "" clears it' })
  @IsOptional()
  @IsString()
  @Matches(CATALOG_VALUE_OR_EMPTY)
  component?: string;

  @ApiPropertyOptional({ description: 'SUB_COMPONENT catalog value; "" clears it' })
  @IsOptional()
  @IsString()
  @Matches(CATALOG_VALUE_OR_EMPTY)
  subComponent?: string;

  @ApiPropertyOptional({ description: "Assignee Group (one a client may pick)" })
  @IsOptional()
  @IsUUID()
  ownerGroupId?: string;

  @ApiPropertyOptional({ description: 'Assignee, a member of the group; "" unassigns' })
  @IsOptional()
  @ValidateIf((o: UpdateCustomerReportDto) => o.ownerUserId !== "")
  @IsUUID()
  ownerUserId?: string;

  @ApiPropertyOptional({ type: [String], description: "CC List" })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_CC_EMAILS)
  @IsEmail({}, { each: true })
  ccEmails?: string[];

  @ApiPropertyOptional({ description: 'Ref Bug ID (INC-000123); "" clears it' })
  @IsOptional()
  @IsString()
  @Length(0, 32)
  refIncidentNo?: string;
}
