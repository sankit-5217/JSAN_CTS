import { ApiProperty } from "@nestjs/swagger";
import { IsBoolean, IsInt, IsOptional, Max, Min } from "class-validator";

export class UpdateRoutingPolicyDto {
  @ApiProperty({
    description:
      "Auto-route newly created incidents at this site: offer each one to the best-matched engineer on shift, then the next if they decline or don't answer",
  })
  @IsBoolean()
  autoAssignEnabled!: boolean;

  @ApiProperty({
    required: false,
    minimum: 1,
    maximum: 120,
    description: "Minutes an engineer has to accept an offer before it moves on (default 5)",
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(120)
  offerTimeoutMinutes?: number;
}
