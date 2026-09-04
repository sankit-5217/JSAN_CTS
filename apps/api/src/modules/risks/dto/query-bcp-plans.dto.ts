import { ApiPropertyOptional } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import { IsBoolean, IsIn, IsInt, IsOptional, IsUUID, Max, Min } from "class-validator";

export const BCP_PLAN_VIEWS = ["due"] as const;
export type BcpPlanView = (typeof BCP_PLAN_VIEWS)[number];

/** Read-side filters for `GET /bcp-plans`. */
export class QueryBcpPlansDto {
  @ApiPropertyOptional({ format: "uuid", description: "Plans covering this site." })
  @IsOptional()
  @IsUUID()
  siteId?: string;

  @ApiPropertyOptional({
    enum: [...BCP_PLAN_VIEWS],
    description: "`due` = tested before but the next test date has passed.",
  })
  @IsOptional()
  @IsIn(BCP_PLAN_VIEWS)
  view?: BcpPlanView;

  @ApiPropertyOptional({ description: "Filter by active flag." })
  @IsOptional()
  @Transform(({ value }) => (value === "true" ? true : value === "false" ? false : value))
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ default: 50, minimum: 1, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}
