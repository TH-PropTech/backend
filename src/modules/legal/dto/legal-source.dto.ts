import {
  ApiProperty,
  ApiPropertyOptional,
  OmitType,
  PartialType,
} from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator'
import {
  LEGAL_SOURCE_ICONS,
  LEGAL_SOURCE_KEY_PATTERN,
  LEGAL_SOURCE_KINDS,
  type LegalSourceIcon,
  type LegalSourceKind,
} from '../utils/legal-sources.types'
import type { LegalSource } from '../schemas/legal-source.schema'

const MAX_ITEMS = 50
const SHORT_TEXT = 300
const LONG_TEXT = 4000
const HTTPS_URL = { protocols: ['https'], require_protocol: true }

export class DossierItemDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(SHORT_TEXT)
  title!: string

  @IsString()
  @MaxLength(LONG_TEXT)
  detail!: string

  @IsOptional()
  @IsBoolean()
  isPropTechExport?: boolean
}

export class ExecutionStepDto {
  @IsInt()
  @Min(1)
  step!: number

  @IsString()
  @IsNotEmpty()
  @MaxLength(SHORT_TEXT)
  title!: string

  @IsString()
  @MaxLength(LONG_TEXT)
  detail!: string
}

export class LegalGroundDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(SHORT_TEXT)
  title!: string

  @IsString()
  @MaxLength(SHORT_TEXT)
  article!: string

  @IsOptional()
  @IsUrl(HTTPS_URL, { message: 'legalGrounds.url phải là URL https://' })
  url?: string
}

export class CreateLegalSourceDto {
  @ApiProperty({ example: '1.004194' })
  @IsString()
  @Matches(LEGAL_SOURCE_KEY_PATTERN, {
    message: 'key chỉ gồm chữ thường, số, "." và "-" (2–64 ký tự)',
  })
  key!: string

  @ApiProperty({ enum: LEGAL_SOURCE_KINDS })
  @IsIn(LEGAL_SOURCE_KINDS)
  kind!: LegalSourceKind

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  code!: string

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title!: string

  @ApiProperty()
  @IsString()
  @MaxLength(SHORT_TEXT)
  subtitle!: string

  @ApiProperty()
  @IsString()
  @MaxLength(SHORT_TEXT)
  agency!: string

  @ApiProperty()
  @IsString()
  @MaxLength(SHORT_TEXT)
  duration!: string

  @ApiProperty()
  @IsString()
  @MaxLength(SHORT_TEXT)
  fee!: string

  @ApiProperty({ example: 'https://dichvucong.gov.vn/...' })
  @IsUrl(HTTPS_URL, { message: 'externalUrl phải là URL https://' })
  externalUrl!: string

  @ApiProperty({ enum: LEGAL_SOURCE_ICONS })
  @IsIn(LEGAL_SOURCE_ICONS)
  icon!: LegalSourceIcon

  @ApiProperty()
  @IsString()
  @MaxLength(LONG_TEXT)
  description!: string

  @ApiProperty({ type: [DossierItemDto] })
  @IsArray()
  @ArrayMaxSize(MAX_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => DossierItemDto)
  dossierItems!: DossierItemDto[]

  @ApiProperty({ type: [ExecutionStepDto] })
  @IsArray()
  @ArrayMaxSize(MAX_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => ExecutionStepDto)
  steps!: ExecutionStepDto[]

  @ApiProperty({ type: [LegalGroundDto] })
  @IsArray()
  @ArrayMaxSize(MAX_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => LegalGroundDto)
  legalGrounds!: LegalGroundDto[]

  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMaxSize(MAX_ITEMS)
  @IsString({ each: true })
  @MaxLength(LONG_TEXT, { each: true })
  notes!: string[]

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  showInContractPanel?: boolean

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean
}

/** `key` bất biến: không có trong DTO update nên bị `forbidNonWhitelisted` từ chối */
export class UpdateLegalSourceDto extends PartialType(
  OmitType(CreateLegalSourceDto, ['key'] as const)
) {}

export class ReorderLegalSourcesDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  keys!: string[]
}

export class ListLegalSourcesQueryDto {
  @ApiPropertyOptional({ enum: ['contract'] })
  @IsOptional()
  @IsIn(['contract'])
  panel?: 'contract'
}

export interface LegalSourceResponse {
  id: string
  key: string
  kind: LegalSourceKind
  code: string
  title: string
  subtitle: string
  agency: string
  duration: string
  fee: string
  externalUrl: string
  icon: LegalSourceIcon
  description: string
  dossierItems: LegalSource['dossierItems']
  steps: LegalSource['steps']
  legalGrounds: LegalSource['legalGrounds']
  notes: string[]
  showInContractPanel: boolean
  order: number
  isActive: boolean
  updatedBy?: string | undefined
  updatedAt?: Date | undefined
}

export type PublicLegalSourceResponse = Omit<LegalSourceResponse, 'updatedBy'>

/** Projection cho endpoint public: không lộ id admin đã sửa */
export function toPublicLegalSourceResponse(
  source: LegalSource
): PublicLegalSourceResponse {
  return {
    id: source._id.toString(),
    key: source.key,
    kind: source.kind,
    code: source.code,
    title: source.title,
    subtitle: source.subtitle,
    agency: source.agency,
    duration: source.duration,
    fee: source.fee,
    externalUrl: source.externalUrl,
    icon: source.icon,
    description: source.description,
    dossierItems: source.dossierItems ?? [],
    steps: source.steps ?? [],
    legalGrounds: source.legalGrounds ?? [],
    notes: source.notes ?? [],
    showInContractPanel: source.showInContractPanel ?? false,
    order: source.order,
    isActive: source.isActive ?? true,
    updatedAt: source.updatedAt,
  }
}

export function toLegalSourceResponse(
  source: LegalSource
): LegalSourceResponse {
  return { ...toPublicLegalSourceResponse(source), updatedBy: source.updatedBy }
}
