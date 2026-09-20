import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import {
  ArrayMaxSize,
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
  MinLength,
  MaxLength,
  ValidateNested,
} from 'class-validator'
import { Type } from 'class-transformer'
import type { RentalExecutionPolicyRef } from '../../rental-flow-config/rental-execution-policy.util'

class RentalExecutionPolicyRefDto implements RentalExecutionPolicyRef {
  @IsString()
  @IsNotEmpty()
  policyId!: string

  @IsInt()
  @Min(1)
  version!: number

  @IsIn(['DEPOSIT_FIRST', 'SIGN_FIRST'])
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

  @ApiPropertyOptional({ description: 'ID tòa nhà' })
  @IsString()
  @IsOptional()
  buildingId?: string | null

  @ApiPropertyOptional({ description: 'Tên tòa nhà' })
  @IsString()
  @IsOptional()
  buildingName?: string | null

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

  @ApiProperty({
    description: 'Mô tả chi tiết',
    minLength: 50,
    maxLength: 5000,
  })
  @IsString()
  @MinLength(50)
  @MaxLength(5000)
  description!: string

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

  @ApiProperty({ description: 'Quận/Huyện' })
  @IsString()
  @IsNotEmpty()
  district!: string

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
