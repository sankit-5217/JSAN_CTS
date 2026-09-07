import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
} from "class-validator";

/**
 * A business-continuity plan for one site or one named service (spec §10.15).
 * Exactly one of `siteId` / `serviceName` identifies what it covers — the
 * service enforces that. RTO / RPO are held in minutes.
 */
export class CreateBcpPlanDto {
  @ApiProperty({ example: "SITE01 core routing failover" })
  @IsString()
  @Length(3, 200)
  name!: string;

  @ApiPropertyOptional({
    format: "uuid",
    description: "Site the plan covers (omit for a service plan).",
  })
  @IsOptional()
  @IsUUID()
  siteId?: string;

  @ApiPropertyOptional({ description: "Named service the plan covers, when not site-scoped." })
  @IsOptional()
  @IsString()
  @Length(2, 200)
  serviceName?: string;

  @ApiProperty({
    description: "How the service is recovered (failover steps, order, dependencies).",
  })
  @IsString()
  @Length(3, 8000)
  recoveryStrategy!: string;

  @ApiPropertyOptional({ description: "Where work fails over to." })
  @IsOptional()
  @IsString()
  @Length(2, 400)
  alternateSite?: string;

  @ApiProperty({ description: "Recovery Time Objective, minutes.", minimum: 0, maximum: 43200 })
  @IsInt()
  @Min(0)
  @Max(43200)
  rtoMinutes!: number;

  @ApiProperty({ description: "Recovery Point Objective, minutes.", minimum: 0, maximum: 43200 })
  @IsInt()
  @Min(0)
  @Max(43200)
  rpoMinutes!: number;

  @ApiPropertyOptional({
    description: "Target availability %, e.g. 99.9. Do not claim what isn't real.",
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  targetAvailabilityPercent?: number;

  @ApiPropertyOptional({ description: "Residual risk once the plan is applied." })
  @IsOptional()
  @IsString()
  @Length(3, 4000)
  residualRisk?: string;

  @ApiPropertyOptional({ description: "Recovery contacts / on-call roster (free text)." })
  @IsOptional()
  @IsString()
  @Length(2, 4000)
  contacts?: string;

  @ApiPropertyOptional({ format: "uuid", description: "Plan owner (accountable person)." })
  @IsOptional()
  @IsUUID()
  ownerId?: string;

  @ApiPropertyOptional({ description: "ISO-8601 UTC; when the plan was last exercised." })
  @IsOptional()
  @IsISO8601()
  lastTestedAt?: string;

  @ApiPropertyOptional({ description: "ISO-8601 UTC; when the next test is due." })
  @IsOptional()
  @IsISO8601()
  nextTestDueAt?: string;
}
