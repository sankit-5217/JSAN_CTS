import { ApiProperty } from "@nestjs/swagger";
import { Priority } from "@prisma/client";
import { IsEnum, IsIn, IsOptional, IsString, IsUUID, Length, ValidateIf } from "class-validator";
import { IMPACT_URGENCY_VALUES } from "./create-incident.dto";

// Deliberately has no `status` field — status only ever changes through
// POST /incidents/:id/transition (CLAUDE.md: never let the frontend set
// incident.status directly). This isn't role-gated out, it's absent.
export class UpdateIncidentDto {
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
