import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsISO8601, IsOptional, IsString, Length } from "class-validator";

/**
 * Log a BCP test (spec §10.15 "last test date", §10.16 "test evidence").
 * `testedAt` defaults to now; `nextTestDueAt` sets the following cadence.
 */
export class RecordBcpTestDto {
  @ApiPropertyOptional({ description: "ISO-8601 UTC; when the test ran. Defaults to now." })
  @IsOptional()
  @IsISO8601()
  testedAt?: string;

  @ApiPropertyOptional({ description: "ISO-8601 UTC; when the next test is due." })
  @IsOptional()
  @IsISO8601()
  nextTestDueAt?: string;

  @ApiPropertyOptional({ description: "Result summary / evidence pointer." })
  @IsOptional()
  @IsString()
  @Length(3, 4000)
  notes?: string;
}
