import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { WorklogActivityType } from "@prisma/client";
import { IsBoolean, IsDate, IsEnum, IsOptional, IsString, Length } from "class-validator";

// durationMinutes is deliberately absent — same rule as Incident.status:
// derived server-side from startedAt/endedAt (spec §10.7), never accepted
// as client input.
export class CreateWorklogDto {
  @ApiProperty({ enum: WorklogActivityType })
  @IsEnum(WorklogActivityType)
  activityType!: WorklogActivityType;

  @ApiProperty({ example: "2026-09-03T09:00:00Z" })
  @Type(() => Date)
  @IsDate()
  startedAt!: Date;

  @ApiProperty({ required: false, description: "Omit if the activity is still in progress" })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  endedAt?: Date;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(1, 2000)
  notes?: string;

  // No default assumed (spec §10.7: "Configurable; not assumed").
  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  billable?: boolean;
}
