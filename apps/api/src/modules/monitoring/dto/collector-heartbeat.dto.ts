import { ApiProperty } from "@nestjs/swagger";
import { IsString, Length } from "class-validator";

/** A site collector's liveness ping (spec §26). */
export class CollectorHeartbeatDto {
  @ApiProperty({ example: "SITE01" })
  @IsString()
  @Length(1, 50)
  siteCode!: string;
}
