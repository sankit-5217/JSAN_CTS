import { ApiProperty } from "@nestjs/swagger";
import { NotificationUrgency } from "@prisma/client";
import { IsEnum } from "class-validator";

export class SetSoundRuleDto {
  @ApiProperty({ enum: NotificationUrgency })
  @IsEnum(NotificationUrgency)
  urgency!: NotificationUrgency;
}
