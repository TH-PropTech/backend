import { ApiPropertyOptional, PartialType } from '@nestjs/swagger'
import { Transform, Type } from 'class-transformer'
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator'
import {
  LEGAL_DOC_CATEGORIES,
  type LegalDocCategory,
  type LegalDocStatus,
} from '../utils/legal-knowledge.types'

export const LEGAL_TITLE_MIN = 3
export const LEGAL_TITLE_MAX = 300
export const LEGAL_CONTENT_MIN = 20
export const LEGAL_CONTENT_MAX = 500_000
export const LEGAL_URL_MAX = 2000
export const LEGAL_KEYWORDS_MAX = 30
export const LEGAL_KEYWORD_MAX = 60
const SHORT_TEXT = 300
const SUMMARY_MAX = 2000
const SEARCH_QUERY_MAX = 500
const HTTP_URL = { protocols: ['http', 'https'], require_protocol: true }
const LEGAL_DOC_STATUSES = ['draft', 'published', 'archived'] as const

const trimString = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value

/** Trims, drops empty entries and removes duplicates (case-insensitive), keeping the first spelling. */
export function normalizeKeywords(
  values: readonly string[] | undefined
): string[] {
  if (!values) return []
  const seen = new Set<string>()
  const result: string[] = []
  for (const raw of values) {
    const value = raw.trim()
    if (value.length === 0) continue
    const key = value.toLocaleLowerCase('vi')
    if (seen.has(key)) continue
    seen.add(key)
    result.push(value)
  }
  return result
}

const keywordsTransform = ({ value }: { value: unknown }): unknown => {
  if (!Array.isArray(value)) return value
  return normalizeKeywords(
    value.filter((item): item is string => typeof item === 'string')
  )
}

export class ListLegalDocsQueryDto {
  @IsOptional()
  @IsIn(LEGAL_DOC_STATUSES)
  status?: LegalDocStatus

  @IsOptional()
  @IsIn(LEGAL_DOC_CATEGORIES)
  category?: LegalDocCategory

  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(200)
  q?: string
}

export class FetchLegalLinkDto {
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(LEGAL_URL_MAX)
  @IsUrl(HTTP_URL)
  url!: string
}

/** Optional doc fields, shared by create and update. */
class LegalDocOptionalFieldsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(SHORT_TEXT)
  docNumber?: string

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(SHORT_TEXT)
  issuer?: string

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(LEGAL_URL_MAX)
  @IsUrl(HTTP_URL)
  sourceUrl?: string

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(LEGAL_KEYWORDS_MAX)
  @Transform(keywordsTransform)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(LEGAL_KEYWORD_MAX, { each: true })
  keywords?: string[]

  @ApiPropertyOptional({ description: 'ISO date' })
  @IsOptional()
  @Transform(trimString)
  @IsDateString()
  effectiveDate?: string

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(SUMMARY_MAX)
  summary?: string

  @ApiPropertyOptional({ enum: ['link', 'manual'] })
  @IsOptional()
  @IsIn(['link', 'manual'])
  contentSource?: 'link' | 'manual'
}

/** Required fields have no IsOptional, so they are required on create. */
export class CreateLegalDocDto extends LegalDocOptionalFieldsDto {
  @Transform(trimString)
  @IsString()
  @MinLength(LEGAL_TITLE_MIN)
  @MaxLength(LEGAL_TITLE_MAX)
  title!: string

  @IsIn(LEGAL_DOC_CATEGORIES)
  category!: LegalDocCategory

  @IsString()
  @MinLength(LEGAL_CONTENT_MIN)
  @MaxLength(LEGAL_CONTENT_MAX)
  content!: string

  @ApiPropertyOptional({ enum: ['draft', 'published'] })
  @IsOptional()
  @IsIn(['draft', 'published'])
  status?: 'draft' | 'published'
}

export class UpdateLegalDocDto extends PartialType(CreateLegalDocDto) {}

export class SearchLegalDto {
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(SEARCH_QUERY_MAX)
  query!: string

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  limit?: number
}
