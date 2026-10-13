import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator'
import {
  LEGAL_SOURCE_KEY_PATTERN,
  PROPERTY_SCOPES,
  REGULATION_CATEGORIES,
  REGULATION_SEVERITIES,
  type PropertyScope,
  type RegulationCategory,
  type RegulationSeverity,
} from '../utils/legal-sources.types'
import type { PlatformRegulation } from '../schemas/platform-regulation.schema'

export class RegulationChecklistItemDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  id!: string

  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  label!: string

  @IsOptional()
  @IsString()
  @MaxLength(500)
  hint?: string
}

export class CreatePlatformRegulationDto {
  @ApiProperty({ example: 'REG-RES-01' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  code!: string

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title!: string

  @ApiProperty()
  @IsString()
  @MaxLength(2000)
  summary!: string

  @ApiProperty({ enum: REGULATION_CATEGORIES })
  @IsIn(REGULATION_CATEGORIES)
  category!: RegulationCategory

  @ApiProperty({ enum: REGULATION_SEVERITIES })
  @IsIn(REGULATION_SEVERITIES)
  severity!: RegulationSeverity

  @ApiProperty({ enum: PROPERTY_SCOPES, isArray: true })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsIn(PROPERTY_SCOPES, { each: true })
  scope!: PropertyScope[]

  @ApiPropertyOptional({ nullable: true, example: '1.004194' })
  @IsOptional()
  @Matches(LEGAL_SOURCE_KEY_PATTERN)
  linkedSourceKey?: string | null

  @ApiProperty({ type: [RegulationChecklistItemDto] })
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => RegulationChecklistItemDto)
  checklistItems!: RegulationChecklistItemDto[]

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean
}

export class UpdatePlatformRegulationDto extends PartialType(
  CreatePlatformRegulationDto
) {}

export class ReorderPlatformRegulationsDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayUnique()
  @IsMongoId({ each: true })
  ids!: string[]
}

export interface PlatformRegulationResponse {
  id: string
  code: string
  title: string
  summary: string
  category: RegulationCategory
  severity: RegulationSeverity
  scope: PropertyScope[]
  linkedSourceKey: string | null
  checklistItems: PlatformRegulation['checklistItems']
  order: number
  isActive: boolean
  isDefault: boolean
  updatedBy?: string | undefined
  updatedAt?: Date | undefined
}

export function toPlatformRegulationResponse(
  reg: PlatformRegulation
): PlatformRegulationResponse {
  return {
    id: reg._id.toString(),
    code: reg.code,
    title: reg.title,
    summary: reg.summary,
    category: reg.category,
    severity: reg.severity,
    scope: reg.scope ?? [],
    linkedSourceKey: reg.linkedSourceKey ?? null,
    checklistItems: reg.checklistItems ?? [],
    order: reg.order,
    isActive: reg.isActive ?? true,
    isDefault: reg.isDefault ?? false,
    updatedBy: reg.updatedBy,
    updatedAt: reg.updatedAt,
  }
}
