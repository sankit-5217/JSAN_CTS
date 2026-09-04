import { ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsBoolean,
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
 * Patch a BCP plan. What the plan covers (`siteId` / `serviceName`) is fixed at
 * creation — retire the plan and make a new one to re-scope it. Recording a
 * test goes through POST /bcp-plans/:id/tests instead.
 */
export class UpdateBcpPlanDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(3, 200)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(3, 8000)
  recoveryStrategy?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(2, 400)
  alternateSite?: string;

  @ApiPropertyOptional({ minimum: 0, maximum: 43200 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(43200)
  rtoMinutes?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 43200 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(43200)
  rpoMinutes?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 100 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  targetAvailabilityPercent?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(3, 4000)
  residualRisk?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(2, 4000)
  contacts?: string;

  @ApiPropertyOptional({ format: "uuid" })
  @IsOptional()
  @IsUUID()
  ownerId?: string;

  @ApiPropertyOptional({ description: "Retire a plan without deleting it." })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: "ISO-8601 UTC; adjust the next test date without logging a test." })
  @IsOptional()
  @IsISO8601()
  nextTestDueAt?: string;
}
