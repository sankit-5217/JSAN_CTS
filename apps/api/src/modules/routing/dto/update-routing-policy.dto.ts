import { ApiProperty } from "@nestjs/swagger";
import { IsBoolean } from "class-validator";

export class UpdateRoutingPolicyDto {
  @ApiProperty({
    description:
      "Auto-assign newly created incidents at this site to the top skill-routing suggestion (NEW -> ASSIGNED)",
  })
  @IsBoolean()
  autoAssignEnabled!: boolean;
}
