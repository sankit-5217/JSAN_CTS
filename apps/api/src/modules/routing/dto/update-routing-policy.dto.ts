import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsBoolean, IsInt, IsOptional, Max, Min } from "class-validator";

const minutes = (priority: string, dflt: number) =>
  ApiPropertyOptional({
    minimum: 1,
    maximum: 120,
    default: dflt,
    description: `Minutes an engineer has to accept an offer on a ${priority} incident`,
  });

const weight = (priority: string, dflt: number) =>
  ApiPropertyOptional({
    minimum: 0,
    maximum: 20,
    default: dflt,
    description: `How much one open ${priority} incident counts toward an engineer's workload`,
  });

export class UpdateRoutingPolicyDto {
  @ApiProperty({
    description:
      "Auto-route newly created incidents at this site: offer each one to the best-matched engineer on shift, then the next if they decline or don't answer",
  })
  @IsBoolean()
  autoAssignEnabled!: boolean;

  @minutes("P1", 2)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(120)
  offerTimeoutP1Minutes?: number;

  @minutes("P2", 5)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(120)
  offerTimeoutP2Minutes?: number;

  @minutes("P3", 10)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(120)
  offerTimeoutP3Minutes?: number;

  @minutes("P4", 15)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(120)
  offerTimeoutP4Minutes?: number;

  @weight("P1", 4)
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(20)
  workloadWeightP1?: number;

  @weight("P2", 3)
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(20)
  workloadWeightP2?: number;

  @weight("P3", 2)
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(20)
  workloadWeightP3?: number;

  @weight("P4", 1)
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(20)
  workloadWeightP4?: number;
}
