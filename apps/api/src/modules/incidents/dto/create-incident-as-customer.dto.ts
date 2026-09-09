import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsOptional, IsString, IsUUID, Length } from "class-validator";

// A deliberately narrow, curated set for the customer-facing "what kind of
// issue" picker — the full free-text `category` field on CreateIncidentDto
// is an internal/triage concept, not something a site POC should be
// choosing from.
export const CUSTOMER_ISSUE_CATEGORIES = [
  "HARDWARE_FAILURE",
  "NETWORK",
  "POWER",
  "COOLING",
  "ACCESS_REQUEST",
  "OTHER",
] as const;
export type CustomerIssueCategory = (typeof CUSTOMER_ISSUE_CATEGORIES)[number];

/**
 * What a site POC (CTS_MANAGER_VIEWER) submits to self-report an issue.
 * Deliberately excludes priority/impact/urgency/ciId — those are triage
 * calls the internal team makes, not something a customer sets (see
 * IncidentsService.createFromCustomer, which fills in a safe default and
 * lets Service Desk reclassify via the normal PATCH /incidents/:id path).
 */
export class CreateIncidentAsCustomerDto {
  @ApiProperty({ description: "Site the issue is at — must be one the caller has access to" })
  @IsUUID()
  siteId!: string;

  @ApiProperty({ enum: CUSTOMER_ISSUE_CATEGORIES, example: "HARDWARE_FAILURE" })
  @IsIn(CUSTOMER_ISSUE_CATEGORIES)
  category!: CustomerIssueCategory;

  @ApiProperty({ example: "Server in Rack 3 is showing a red fault light" })
  @IsString()
  @Length(2, 256)
  shortDescription!: string;

  @ApiPropertyOptional({
    example: "Started around 2pm, other equipment in the rack seems fine.",
    description: "Posted as the ticket's first customer-visible comment, if provided.",
  })
  @IsOptional()
  @IsString()
  @Length(1, 4000)
  details?: string;
}
