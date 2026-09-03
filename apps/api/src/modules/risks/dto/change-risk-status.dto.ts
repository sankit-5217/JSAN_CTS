import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsOptional, IsString, Length } from "class-validator";
import { RISK_STATUSES } from "../risks.constants";
import type { RiskStatus } from "../risks.constants";

export class ChangeRiskStatusDto {
  @ApiProperty({ enum: [...RISK_STATUSES] })
  @IsIn(RISK_STATUSES)
  status!: RiskStatus;

  @ApiPropertyOptional({
    description:
      "Mitigation / acceptance rationale. Required when moving to MITIGATING or ACCEPTED and the risk has none recorded.",
  })
  @IsOptional()
  @IsString()
  @Length(3, 4000)
  mitigation?: string;
}
