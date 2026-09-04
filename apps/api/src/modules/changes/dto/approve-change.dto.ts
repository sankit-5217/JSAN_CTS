import { ApiProperty } from "@nestjs/swagger";
import { IsUUID } from "class-validator";

export class ApproveChangeDto {
  @ApiProperty({
    format: "uuid",
    description: "User id of the approver (INFRASTRUCTURE_LEAD / DELIVERY_OPS_MANAGER)",
  })
  @IsUUID()
  approverId!: string;
}
