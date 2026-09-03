import { ApiProperty } from "@nestjs/swagger";
import { IsIn, IsUUID } from "class-validator";

// Matches spec §9.2's CMDB relationship examples (SERVICE runs_on SERVER,
// SERVER depends_on SWITCH/UPS, RACK contains SERVER, ...). Kept as a
// validated string rather than a Postgres enum on CiRelation.relationType
// so new relation kinds don't need a schema migration.
export const CI_RELATION_TYPES = ["CONTAINS", "DEPENDS_ON", "RUNS_ON", "USES"] as const;
export type CiRelationType = (typeof CI_RELATION_TYPES)[number];

export class CreateCiRelationDto {
  @ApiProperty({ description: "The other CI in the relationship" })
  @IsUUID()
  relatedCiId!: string;

  @ApiProperty({ enum: CI_RELATION_TYPES })
  @IsIn(CI_RELATION_TYPES)
  relationType!: CiRelationType;

  @ApiProperty({
    enum: ["PARENT", "CHILD"],
    description: "Is the CI in the URL the parent or child of relatedCiId?",
  })
  @IsIn(["PARENT", "CHILD"])
  direction!: "PARENT" | "CHILD";
}
