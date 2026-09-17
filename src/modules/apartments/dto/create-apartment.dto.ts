import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  IsArray,
  IsIn,
  IsInt,
  IsObject,
  Min,
  ValidateNested,
} from 'class-validator'
import { Type } from 'class-transformer'

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
}

export class CreateApartmentDto {
  @ApiProperty({ description: 'Tiêu đề tin đăng' })
  @IsString()
  @IsNotEmpty()
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

  @ApiProperty({ description: 'Danh mục căn hộ' })
  @IsString()
  @IsNotEmpty()
  category!: string

  @ApiProperty({ description: 'Mô tả chi tiết' })
  @IsString()
  @IsNotEmpty()
  description!: string

  @ApiProperty({ description: 'Địa chỉ đầy đủ' })
  @IsString()
  @IsNotEmpty()
  location!: string

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
  area!: number

  @ApiProperty({ description: 'Số phòng ngủ' })
  @Type(() => Number)
  @IsNumber()
  bedrooms!: number

  @ApiProperty({ description: 'Số phòng tắm' })
  @Type(() => Number)
  @IsNumber()
  bathrooms!: number

  @ApiProperty({ description: 'Hướng nhà' })
  @IsString()
  @IsNotEmpty()
  direction!: string

  @ApiProperty({ description: 'Hướng ban công' })
  @IsString()
  @IsNotEmpty()
  balconyDirection!: string

  @ApiProperty({ description: 'Tình trạng nội thất' })
  @IsString()
  @IsNotEmpty()
  furniture!: string

  @ApiProperty({ description: 'Thời gian dọn vào' })
  @IsString()
  @IsNotEmpty()
  moveInTime!: string

  @ApiProperty({ description: 'Thông tin tiền điện' })
  @IsString()
  @IsNotEmpty()
  electricity!: string

  @ApiProperty({ description: 'Thông tin tiền nước' })
  @IsString()
  @IsNotEmpty()
  water!: string

  @ApiProperty({ description: 'Thông tin internet' })
  @IsString()
  @IsNotEmpty()
  internet!: string

  @ApiPropertyOptional({ description: 'Danh sách ảnh thường' })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  gallery?: string[]

  @ApiPropertyOptional({ description: 'Danh sách ảnh 360' })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  images360?: string[]

  @ApiPropertyOptional({ description: 'Link VR Tour' })
  @IsString()
  @IsOptional()
  vrUrl?: string

  @ApiPropertyOptional({ description: 'Danh sách tiện ích' })
  @IsArray()
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
