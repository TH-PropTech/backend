import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  IsPositive,
  IsArray,
  IsIn,
  IsInt,
  IsObject,
  Min,
  Max,
  MinLength,
  MaxLength,
  ValidateNested,
  ValidateIf,
} from 'class-validator'
import { Type } from 'class-transformer'
import type { RentalExecutionPolicyRef } from '../../rental/utils/rental-execution-policy.util'

class RentalExecutionPolicyRefDto implements RentalExecutionPolicyRef {
  @IsString()
  @IsNotEmpty()
  policyId!: string

  @IsInt()
  @Min(1)
  version!: number

  @IsIn(['SIGN_FIRST'])
  strategy!: RentalExecutionPolicyRef['strategy']

  @IsString()
  @IsNotEmpty()
  contentHash!: string
}

class RentalPackageDepositPolicyDto {
  @IsIn(['MONTHS_OF_RENT', 'FIXED_AMOUNT'])
  type!: 'MONTHS_OF_RENT' | 'FIXED_AMOUNT'

  @IsOptional()
  @IsInt()
  @Min(1)
  months?: number

  @IsOptional()
  @IsInt()
  @Min(1)
  amount?: number
}

class HoldingDepositDto {
  @IsIn(['FIXED_AMOUNT', 'PERCENT_OF_SECURITY'])
  type!: 'FIXED_AMOUNT' | 'PERCENT_OF_SECURITY'

  @IsOptional()
  @IsInt()
  @Min(1)
  amount?: number

  @IsOptional()
  @IsNumber()
  @Min(0.01)
  percent?: number
}

class PrepaidRentDto {
  @ApiProperty({ enum: ['NONE', 'MONTHS', 'FULL'] })
  @IsIn(['NONE', 'MONTHS', 'FULL'])
  type!: 'NONE' | 'MONTHS' | 'FULL'

  @ApiPropertyOptional({
    description: 'Số tháng tiền thuê trả trước (bắt buộc khi type = MONTHS)',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(24)
  months?: number
}

class SettlementPolicyDto {
  @ApiPropertyOptional({ type: HoldingDepositDto })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => HoldingDepositDto)
  holdingDeposit?: HoldingDepositDto

  @ApiProperty({ enum: [1, 3, 6], isArray: true })
  @IsArray()
  @ArrayNotEmpty()
  @IsIn([1, 3, 6], { each: true })
  allowedPaymentCycles!: Array<1 | 3 | 6>

  @ApiProperty({ enum: [1, 3, 6] })
  @IsInt()
  @IsIn([1, 3, 6])
  defaultPaymentCycle!: 1 | 3 | 6

  @ApiProperty({ minimum: 0, maximum: 15 })
  @IsInt()
  @Min(0)
  @Max(15)
  firstPaymentDueOffsetDays!: number
}

class MoveOutPolicyDto {
  @ApiProperty({
    minimum: 1,
    maximum: 15,
    description:
      'Số ngày (theo lịch) khách có để phản hồi biên bản trả nhà và bảng khấu trừ cọc',
  })
  @IsInt()
  @Min(1)
  @Max(15)
  responseDays!: number
}

export class RentalPackageDto {
  @IsString()
  @IsNotEmpty()
  packageId!: string

  @IsInt()
  @Min(1)
  version!: number

  @IsInt()
  @IsIn([3, 6, 12, 24])
  durationMonths!: 3 | 6 | 12 | 24

  @IsInt()
  @Min(1)
  monthlyRent!: number

  @IsObject()
  @ValidateNested()
  @Type(() => RentalPackageDepositPolicyDto)
  depositPolicy!: RentalPackageDepositPolicyDto

  @ApiPropertyOptional({ type: SettlementPolicyDto })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => SettlementPolicyDto)
  settlementPolicy?: SettlementPolicyDto

  @ApiPropertyOptional({
    type: PrepaidRentDto,
    description:
      'Tiền thuê trả trước ngoài tiền cọc: không trả trước / N tháng / toàn bộ',
  })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => PrepaidRentDto)
  prepaidRent?: PrepaidRentDto

  @ApiPropertyOptional({
    type: MoveOutPolicyDto,
    description: 'Vắng mặt = mặc định 3 ngày',
  })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => MoveOutPolicyDto)
  moveOutPolicy?: MoveOutPolicyDto

  @ApiPropertyOptional({ description: 'Số tháng trả trước đã quy đổi' })
  @IsOptional()
  @IsNumber()
  resolvedPrepaidRentMonths?: number

  @ApiPropertyOptional({ description: 'Tiền thuê trả trước đã quy đổi' })
  @IsOptional()
  @IsNumber()
  resolvedPrepaidRentAmount?: number

  @ApiPropertyOptional({ description: 'Tiền cọc tính toán (tùy chọn khi gửi)' })
  @IsOptional()
  @IsNumber()
  resolvedDepositAmount?: number

  @ApiPropertyOptional({ description: 'Tiền giữ chỗ tính toán' })
  @IsOptional()
  @IsNumber()
  resolvedHoldingDepositAmount?: number

  @ApiPropertyOptional({ description: 'Tiền cọc bổ sung tính toán' })
  @IsOptional()
  @IsNumber()
  resolvedSecurityTopUpAmount?: number

  @IsIn(['active', 'inactive'])
  @IsOptional()
  status?: 'active' | 'inactive'

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RentalExecutionPolicyRefDto)
  @IsOptional()
  allowedExecutionPolicies?: RentalExecutionPolicyRefDto[]

  @ValidateNested()
  @Type(() => RentalExecutionPolicyRefDto)
  @IsOptional()
  defaultExecutionPolicy?: RentalExecutionPolicyRefDto
}

// Hệ thống chỉ cho thuê căn hộ (không nhà riêng, văn phòng, shophouse…).
export const APARTMENT_CATEGORIES = [
  'Căn hộ chung cư',
  'Chung cư mini, căn hộ dịch vụ',
] as const

export class CreateApartmentDto {
  @ApiProperty({
    description: 'Tiêu đề tin đăng',
    minLength: 10,
    maxLength: 200,
  })
  @IsString()
  @MinLength(10)
  @MaxLength(200)
  title!: string

  @ApiPropertyOptional({ description: 'ID dự án' })
  @IsString()
  @IsOptional()
  projectId?: string | null

  @ApiPropertyOptional({ description: 'Tên dự án' })
  @IsString()
  @IsOptional()
  projectName?: string | null

  @ApiProperty({
    description: 'Danh mục căn hộ',
    enum: APARTMENT_CATEGORIES,
  })
  @IsIn(APARTMENT_CATEGORIES)
  category!: string

  @ApiPropertyOptional({
    description:
      'Mô tả chi tiết (không bắt buộc; nếu nhập thì tối thiểu 10 ký tự)',
    minLength: 10,
    maxLength: 5000,
  })
  @ValidateIf(
    (_object, value: unknown) =>
      value !== undefined && value !== null && value !== ''
  )
  @IsString()
  @MinLength(10)
  @MaxLength(5000)
  description?: string

  @ApiPropertyOptional({
    description:
      'Địa chỉ đầy đủ; bỏ trống thì backend ghép từ đường, phường, quận, thành phố',
  })
  @IsString()
  @IsOptional()
  location?: string

  @ApiProperty({ description: 'Thành phố' })
  @IsString()
  @IsNotEmpty()
  city!: string

  @ApiPropertyOptional({
    description: 'Số giấy chứng nhận quyền sở hữu/sử dụng căn hộ',
    maxLength: 200,
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  ownershipCertificate?: string

  @ApiProperty({
    description:
      'Quận/Huyện (tùy chọn: cơ cấu hành chính từ 1/7/2025 không còn cấp huyện)',
    required: false,
  })
  @IsString()
  @IsOptional()
  district?: string

  @ApiProperty({ description: 'Phường/Xã' })
  @IsString()
  @IsNotEmpty()
  ward!: string

  @ApiProperty({ description: 'Đường phố' })
  @IsString()
  @IsNotEmpty()
  street!: string

  @ApiProperty({ description: 'Địa chỉ cụ thể (số nhà)' })
  @IsString()
  @IsNotEmpty()
  address!: string

  @ApiProperty({ description: 'Giá thuê hàng tháng (VNĐ)' })
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  priceMonthly!: number

  @ApiPropertyOptional({ type: [RentalPackageDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RentalPackageDto)
  @IsOptional()
  rentalPackages?: RentalPackageDto[]

  @ApiProperty({ description: 'Diện tích (m²)' })
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  area!: number

  @ApiProperty({ description: 'Số phòng ngủ' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  bedrooms!: number

  @ApiProperty({ description: 'Số phòng tắm' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  bathrooms!: number

  @ApiPropertyOptional({ description: 'Hướng nhà' })
  @IsString()
  @IsOptional()
  direction?: string

  @ApiPropertyOptional({ description: 'Hướng ban công' })
  @IsString()
  @IsOptional()
  balconyDirection?: string

  @ApiPropertyOptional({ description: 'Tình trạng nội thất' })
  @IsString()
  @IsOptional()
  furniture?: string

  @ApiPropertyOptional({ description: 'Thời gian dọn vào' })
  @IsString()
  @IsOptional()
  moveInTime?: string

  @ApiPropertyOptional({ description: 'Thông tin tiền điện' })
  @IsString()
  @IsOptional()
  electricity?: string

  @ApiPropertyOptional({ description: 'Thông tin tiền nước' })
  @IsString()
  @IsOptional()
  water?: string

  @ApiPropertyOptional({ description: 'Thông tin internet' })
  @IsString()
  @IsOptional()
  internet?: string

  @ApiPropertyOptional({ description: 'Danh sách ảnh thường (tối đa 20)' })
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @IsOptional()
  gallery?: string[]

  @ApiPropertyOptional({ description: 'Danh sách tiện ích (tối đa 30)' })
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @IsOptional()
  amenities?: string[]
}

export class UpdateRentalPackagesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RentalPackageDto)
  rentalPackages!: RentalPackageDto[]

  @IsInt()
  @Min(0)
  expectedRevision!: number
}
