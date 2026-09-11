import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { UserRole } from "@prisma/client";
import { IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, Min } from "class-validator";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

// Same pagination shape as ListCisQueryDto (spec §14.1).
export class ListUsersQueryDto {
  @ApiProperty({ enum: UserRole, required: false })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  // SITE_ENGINEER (and every other non-ALL_SITES role) only shows up here
  // for sites it has an explicit UserSiteAccess grant for — same rule
  // AuthzService.getAccessibleSiteIds enforces for the caller's own scope.
  @ApiProperty({ required: false, description: "Only users with access to this site" })
  @IsOptional()
  @IsUUID()
  siteId?: string;

  @ApiProperty({ required: false, description: "Matches against displayName or email" })
  @IsOptional()
  @IsString()
  q?: string;

  @ApiProperty({ required: false, default: DEFAULT_LIMIT })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_LIMIT)
  limit?: number = DEFAULT_LIMIT;
}
