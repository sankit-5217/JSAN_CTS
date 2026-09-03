import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsInt, IsISO8601, IsOptional, IsString, IsUUID, Length, Max, Min } from "class-validator";
import { RISK_LEVEL_MAX, RISK_LEVEL_MIN } from "../risks.constants";

/** `score` is computed backend-side (likelihood × impact) — never accepted from the client. */
export class CreateRiskDto {
  @ApiProperty({ example: "Single upstream power feed to Row 4 — no B-feed until Q3 works." })
  @IsString()
  @Length(3, 2000)
  description!: string;

  @ApiProperty({ minimum: RISK_LEVEL_MIN, maximum: RISK_LEVEL_MAX, description: "1–5" })
  @IsInt()
  @Min(RISK_LEVEL_MIN)
  @Max(RISK_LEVEL_MAX)
  likelihood!: number;

  @ApiProperty({ minimum: RISK_LEVEL_MIN, maximum: RISK_LEVEL_MAX, description: "1–5" })
  @IsInt()
  @Min(RISK_LEVEL_MIN)
  @Max(RISK_LEVEL_MAX)
  impact!: number;

  @ApiPropertyOptional({ description: "Planned or in-place mitigation / control." })
  @IsOptional()
  @IsString()
  @Length(3, 4000)
  mitigation?: string;

  @ApiPropertyOptional({ format: "uuid", description: "Risk owner (accountable person)." })
  @IsOptional()
  @IsUUID()
  ownerId?: string;

  @ApiPropertyOptional({ format: "uuid", description: "Site this risk is scoped to, if any." })
  @IsOptional()
  @IsUUID()
  siteId?: string;

  @ApiPropertyOptional({ description: "ISO-8601 UTC; target date for the mitigation." })
  @IsOptional()
  @IsISO8601()
  dueDate?: string;
}
