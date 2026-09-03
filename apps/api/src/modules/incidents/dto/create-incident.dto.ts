import { ApiProperty } from "@nestjs/swagger";
import { Priority } from "@prisma/client";
import { IsEnum, IsIn, IsOptional, IsString, IsUUID, Length } from "class-validator";

// Impact/urgency are plain strings in the schema (no Prisma enum exists for
// them yet) — validated here against spec §16's terms instead.
export const IMPACT_URGENCY_VALUES = ["HIGH", "MEDIUM", "LOW"] as const;

export class CreateIncidentDto {
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
