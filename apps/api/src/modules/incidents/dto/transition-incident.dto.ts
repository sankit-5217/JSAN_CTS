import { ApiProperty } from "@nestjs/swagger";
import { IncidentStatus } from "@prisma/client";
import { IsEnum, IsIn, IsOptional, IsString, IsUUID, Length } from "class-validator";
import { TEMPLATE_STATUSES, TemplateStatus } from "../incident-status-display";

// Field requirements per transition are validated in incident-transitions.ts
// against the incoming status pair, not here — this DTO only shapes/types
// the possible fields any transition might need.
export class TransitionIncidentDto {
  @ApiProperty({ enum: IncidentStatus })
  @IsEnum(IncidentStatus)
  toStatus!: IncidentStatus;

  @ApiProperty({ required: false, description: "Required for PENDING_*, REOPENED, CANCELLED" })
  @IsOptional()
  @IsString()
  @Length(2, 512)
  reason?: string;

  @ApiProperty({
    required: false,
    description: "Set/change owner group as part of this transition",
  })
  @IsOptional()
  @IsUUID()
  ownerGroupId?: string;

  @ApiProperty({ required: false, description: "Set/change owner user as part of this transition" })
  @IsOptional()
  @IsUUID()
  ownerUserId?: string;

  @ApiProperty({ required: false, description: "Required when transitioning to RESOLVED" })
  @IsOptional()
  @IsString()
  @Length(2, 128)
  resolutionCategory?: string;

  @ApiProperty({ required: false, description: "Required when transitioning to RESOLVED" })
  @IsOptional()
  @IsString()
  @Length(2, 2000)
  rootCauseSummary?: string;

  @ApiProperty({
    required: false,
    description:
      "The other ticket (INC-000123) for BLOCKED / DUPLICATE; defaults to the ticket's Ref Bug ID",
  })
  @IsOptional()
  @IsString()
  @Length(1, 32)
  refIncidentNo?: string;
}

/** POST /incidents/:id/status — pick one of the issue template's statuses. */
export class SetTemplateStatusDto {
  @ApiProperty({ enum: TEMPLATE_STATUSES })
  @IsIn(TEMPLATE_STATUSES)
  status!: TemplateStatus;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(2, 512)
  reason?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(2, 128)
  resolutionCategory?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(2, 2000)
  rootCauseSummary?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(1, 32)
  refIncidentNo?: string;
}
