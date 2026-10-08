import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IssueCatalogKind, Priority } from "@prisma/client";
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
} from "class-validator";

// A catalog value is a stable code (what gets stored on the incident), the
// label is what the form shows. Same shape as `category`: UPPER_SNAKE.
export const CATALOG_VALUE_PATTERN = /^[A-Z0-9][A-Z0-9_.-]{0,63}$/;
const VALUE_MESSAGE =
  "value must be an upper-case code (letters, digits, _ . -), e.g. HARDWARE_FAILURE";

export class CreateIssueCatalogOptionDto {
  @ApiProperty({ enum: IssueCatalogKind })
  @IsEnum(IssueCatalogKind)
  kind!: IssueCatalogKind;

  @ApiProperty({ example: "HARDWARE_FAILURE" })
  @IsString()
  @Matches(CATALOG_VALUE_PATTERN, { message: VALUE_MESSAGE })
  value!: string;

  @ApiProperty({ example: "Hardware fault (server, disk, PSU...)" })
  @IsString()
  @Length(1, 120)
  label!: string;

  @ApiPropertyOptional({
    description: "SUB_COMPONENT only: the COMPONENT option this belongs under",
  })
  @IsOptional()
  @IsUUID()
  parentId?: string;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000)
  sortOrder?: number;
}

export class UpdateIssueCatalogOptionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 120)
  label?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000)
  sortOrder?: number;

  @ApiPropertyOptional({ description: "false retires the option (never deleted)" })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CreateIssueTemplateDto {
  @ApiProperty({ description: "The ISSUE_TYPE option this template drafts" })
  @IsUUID()
  issueTypeId!: string;

  @ApiProperty({ example: "Hardware fault" })
  @IsString()
  @Length(1, 120)
  name!: string;

  @ApiPropertyOptional({ example: "[Hardware] <device> in <rack> — <symptom>" })
  @IsOptional()
  @IsString()
  @Length(1, 256)
  subjectDraft?: string;

  @ApiProperty({ description: "Pre-filled description with the headings to complete" })
  @IsString()
  @Length(1, 8000)
  descriptionDraft!: string;

  @ApiPropertyOptional({ enum: Priority })
  @IsOptional()
  @IsEnum(Priority)
  defaultPriority?: Priority;

  @ApiPropertyOptional({ description: "SEVERITY option value" })
  @IsOptional()
  @IsString()
  @Matches(CATALOG_VALUE_PATTERN, { message: VALUE_MESSAGE })
  defaultSeverity?: string;

  @ApiPropertyOptional({ description: "COMPONENT option value" })
  @IsOptional()
  @IsString()
  @Matches(CATALOG_VALUE_PATTERN, { message: VALUE_MESSAGE })
  defaultComponent?: string;

  @ApiPropertyOptional({ description: "SUB_COMPONENT option value (under defaultComponent)" })
  @IsOptional()
  @IsString()
  @Matches(CATALOG_VALUE_PATTERN, { message: VALUE_MESSAGE })
  defaultSubComponent?: string;

  @ApiPropertyOptional({ description: "TOOL option value" })
  @IsOptional()
  @IsString()
  @Matches(CATALOG_VALUE_PATTERN, { message: VALUE_MESSAGE })
  defaultTool?: string;
}

export class UpdateIssueTemplateDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 120)
  name?: string;

  @ApiPropertyOptional({ nullable: true, description: "Empty string clears it" })
  @IsOptional()
  @IsString()
  @Length(0, 256)
  subjectDraft?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 8000)
  descriptionDraft?: string;

  @ApiPropertyOptional({ enum: Priority, description: "Empty string clears it" })
  @IsOptional()
  @IsString()
  defaultPriority?: string;

  @ApiPropertyOptional({ description: "Empty string clears it" })
  @IsOptional()
  @IsString()
  defaultSeverity?: string;

  @ApiPropertyOptional({ description: "Empty string clears it" })
  @IsOptional()
  @IsString()
  defaultComponent?: string;

  @ApiPropertyOptional({ description: "Empty string clears it" })
  @IsOptional()
  @IsString()
  defaultSubComponent?: string;

  @ApiPropertyOptional({ description: "Empty string clears it" })
  @IsOptional()
  @IsString()
  defaultTool?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
