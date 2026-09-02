import { ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsUUID, Max, Min } from "class-validator";
import { DISPATCH_STATUSES } from "../vendors.constants";
import type { DispatchStatus } from "../vendors.constants";

export class QueryVendorCasesDto {
  @ApiPropertyOptional({ format: "uuid" })
  @IsOptional()
  @IsUUID()
  vendorId?: string;

  @ApiPropertyOptional({ format: "uuid" })
  @IsOptional()
  @IsUUID()
  linkedIncidentId?: string;

  @ApiPropertyOptional({ enum: [...DISPATCH_STATUSES] })
  @IsOptional()
  @IsIn(DISPATCH_STATUSES)
  dispatchStatus?: DispatchStatus;

  @ApiPropertyOptional({ enum: ["open", "closed"] })
  @IsOptional()
  @IsIn(["open", "closed"])
  status?: "open" | "closed";

  @ApiPropertyOptional({ default: 50, minimum: 1, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}
