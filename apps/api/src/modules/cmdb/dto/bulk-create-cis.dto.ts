import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { ArrayMaxSize, ArrayMinSize, ValidateNested } from "class-validator";
import { CreateCiDto } from "./create-ci.dto";

// A hard cap, not just a nicety — spec §14.1 forbids unbounded operations
// on list-shaped endpoints, and one all-or-nothing $transaction inserting
// thousands of rows would hold a DB connection open far too long.
const MAX_BULK_ITEMS = 500;

export class BulkCreateCisDto {
  @ApiProperty({ type: [CreateCiDto] })
  @ValidateNested({ each: true })
  @Type(() => CreateCiDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_BULK_ITEMS)
  items!: CreateCiDto[];
}
