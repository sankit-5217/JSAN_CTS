import { ApiProperty } from "@nestjs/swagger";
import { InAppNotificationKind } from "@prisma/client";
import { Type } from "class-transformer";
import { IsEnum, IsIn } from "class-validator";
import { NOTIFICATION_LEVELS, NotificationLevel } from "../notification-sound-rules.service";

export class SoundRuleParamsDto {
  @ApiProperty({ enum: InAppNotificationKind })
  @IsEnum(InAppNotificationKind)
  kind!: InAppNotificationKind;

  @ApiProperty({
    enum: NOTIFICATION_LEVELS,
    description: "1 = P1 / CRITICAL alert … 4 = P4 / INFO",
  })
  @Type(() => Number)
  @IsIn(NOTIFICATION_LEVELS)
  level!: NotificationLevel;
}
