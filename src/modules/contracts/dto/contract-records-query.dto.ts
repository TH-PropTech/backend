import { ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  Validate,
  ValidatorConstraint,
  type ValidationArguments,
  type ValidatorConstraintInterface,
} from 'class-validator'

export const CONTRACT_RECORD_STATUSES = [
  'draft',
  'deposit-pending',
  'deposit-paid',
  'awaiting-signature',
  'fully-signed-pending-deposit',
  'active',
  'terminated',
  'cancelled',
  'completed',
] as const

export const CONTRACT_RECORDS_DEFAULT_PAGE_SIZE = 20
export const CONTRACT_RECORDS_MAX_PAGE_SIZE = 100
const MAX_TEXT_FILTER_LENGTH = 100

@ValidatorConstraint({ name: 'contractRecordsDateRange', async: false })
class DateRangeConstraint implements ValidatorConstraintInterface {
  validate(_value: unknown, args: ValidationArguments): boolean {
    const { from, to } = args.object as ContractRecordsQueryDto
    if (!from || !to) return true
    return new Date(from).getTime() <= new Date(to).getTime()
  }

  defaultMessage(): string {
    return 'from phải nhỏ hơn hoặc bằng to'
  }
}

export class ContractRecordsQueryDto {
  @ApiPropertyOptional({ description: 'Căn hộ: tên hoặc địa chỉ (chứa chuỗi)' })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_TEXT_FILTER_LENGTH)
  property?: string

  @ApiPropertyOptional({ description: 'Khách thuê: họ tên (chứa chuỗi)' })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_TEXT_FILTER_LENGTH)
  tenant?: string

  @ApiPropertyOptional({ description: 'Chủ nhà: họ tên (chứa chuỗi)' })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_TEXT_FILTER_LENGTH)
  landlord?: string

  @ApiPropertyOptional({ enum: CONTRACT_RECORD_STATUSES })
  @IsOptional()
  @IsIn([...CONTRACT_RECORD_STATUSES])
  status?: (typeof CONTRACT_RECORD_STATUSES)[number]

  @ApiPropertyOptional({ description: 'Ngày tạo hợp đồng từ (ISO 8601)' })
  @IsOptional()
  @IsDateString()
  from?: string

  @ApiPropertyOptional({ description: 'Ngày tạo hợp đồng đến (ISO 8601)' })
  @IsOptional()
  @IsDateString()
  @Validate(DateRangeConstraint)
  to?: string

  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number

  @ApiPropertyOptional({
    minimum: 1,
    maximum: CONTRACT_RECORDS_MAX_PAGE_SIZE,
    default: CONTRACT_RECORDS_DEFAULT_PAGE_SIZE,
    description: 'Giá trị lớn hơn mức tối đa sẽ bị ép về mức tối đa ở máy chủ',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize?: number
}
