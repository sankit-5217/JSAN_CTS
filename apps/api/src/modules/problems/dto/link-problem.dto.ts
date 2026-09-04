import { ApiProperty } from "@nestjs/swagger";
import { IsIn, IsUUID } from "class-validator";
import { PROBLEM_LINK_TYPES } from "../problems.constants";
import type { ProblemLinkType } from "../problems.constants";

/** Link a problem to a related incident or change (spec §10.5). */
export class LinkProblemDto {
  @ApiProperty({ enum: [...PROBLEM_LINK_TYPES] })
  @IsIn(PROBLEM_LINK_TYPES)
  entityType!: ProblemLinkType;

  @ApiProperty({ description: "Id of the incident or change to link." })
  @IsUUID()
  entityId!: string;
}
