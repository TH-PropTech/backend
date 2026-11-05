import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  IsArray,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator'
import type { ContractCommercialDraft } from '../schemas/contract.schema'

const UTILITY_PARTIES = ['tenant', 'landlord', 'shared'] as const

export class ContractCommercialDraftDto implements ContractCommercialDraft {
  @ApiProperty({ minimum: 0 })
  @IsNumber()
  @Min(0)
  monthlyRent!: number

  @ApiProperty({ minimum: 0 })
  @IsNumber()
  @Min(0)
  deposit!: number

  @ApiProperty({ minimum: 1, maximum: 31 })
  @IsInt()
  @Min(1)
  @Max(31)
  paymentDay!: number

  @ApiProperty({ minimum: 0, maximum: 20 })
  @IsNumber()
  @Min(0)
  @Max(20)
  latePenaltyRate!: number

  @ApiProperty({ minimum: 1, maximum: 365 })
  @IsInt()
  @Min(1)
  @Max(365)
  terminationNoticeDays!: number

  @ApiProperty({ minimum: 1, maximum: 120 })
  @IsInt()
  @Min(1)
  @Max(120)
  durationMonths!: number

  @ApiPropertyOptional({ additionalProperties: { enum: [...UTILITY_PARTIES] } })
  @IsOptional()
  @IsObject()
  utilities?: Record<string, 'tenant' | 'landlord' | 'shared'>

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  handoverNotes?: string | null

  @ApiPropertyOptional({ maxLength: 128 })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  inventoryReference?: string | null

  @ApiPropertyOptional({ minimum: 1, maximum: 365 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  noticePeriodDays?: number | null

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  addendaIds?: string[]

  /** Chỉ đọc: điều khoản riêng của chủ nhà. Gửi lên sẽ bị từ chối ở service. */
  @ApiPropertyOptional({ maxLength: 2000, readOnly: true })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  customClauses?: string | null
}

export class SaveContractCommercialDraftDto {
  @ApiProperty({ type: ContractCommercialDraftDto })
  @ValidateNested()
  @Type(() => ContractCommercialDraftDto)
  commercial!: ContractCommercialDraftDto

  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  expectedRevision!: number
}

export class ValidateContractCommercialDraftDto {
  @ApiProperty({ type: ContractCommercialDraftDto })
  @ValidateNested()
  @Type(() => ContractCommercialDraftDto)
  commercial!: ContractCommercialDraftDto
}

export class ContractCommercialEditorResponseDto {
  @ApiProperty()
  contractId!: string

  @ApiProperty()
  revision!: number

  @ApiProperty({ type: ContractCommercialDraftDto, nullable: true })
  commercial!: ContractCommercialDraftDto | null

  @ApiProperty({ type: [String] })
  protectedFields!: string[]

  @ApiProperty()
  locked!: boolean

  @ApiProperty({
    type: [String],
    description:
      'Trường chỉ đổi khi khách đồng ý (rỗng nếu hợp đồng không có gói thuê làm mốc)',
  })
  consentRequiredFields!: string[]
}

export class ContractCommercialValidationDto {
  @ApiProperty()
  valid!: boolean

  @ApiProperty({ type: [String] })
  errors!: string[]

  @ApiProperty({ type: [String] })
  changedFields!: string[]
}

export function isUtilityParty(
  value: unknown
): value is (typeof UTILITY_PARTIES)[number] {
  return (
    typeof value === 'string' &&
    UTILITY_PARTIES.includes(value as (typeof UTILITY_PARTIES)[number])
  )
}
