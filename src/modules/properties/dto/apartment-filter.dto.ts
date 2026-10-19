import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsOptional, IsString, IsNumber, IsBoolean } from 'class-validator'
import { Type } from 'class-transformer'

export class ApartmentFilterDto {
  @ApiPropertyOptional({
    description: 'Từ khóa tìm kiếm (tiêu đề, mô tả, địa chỉ)',
  })
  @IsString()
  @IsOptional()
  search?: string

  @ApiPropertyOptional({ description: 'Thành phố' })
  @IsString()
  @IsOptional()
  city?: string

  @ApiPropertyOptional({ description: 'Quận/Huyện' })
  @IsString()
  @IsOptional()
  district?: string

  @ApiPropertyOptional({ description: 'Phường/Xã' })
  @IsString()
  @IsOptional()
  ward?: string

  @ApiPropertyOptional({ description: 'Đường phố' })
  @IsString()
  @IsOptional()
  street?: string

  @ApiPropertyOptional({ description: 'Tên dự án' })
  @IsString()
  @IsOptional()
  projectName?: string

  @ApiPropertyOptional({ description: 'Phân loại căn hộ' })
  @IsString()
  @IsOptional()
  category?: string

  @ApiPropertyOptional({ description: 'Giá tối thiểu (triệu)' })
  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  minPrice?: number

  @ApiPropertyOptional({ description: 'Giá tối đa (triệu)' })
  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  maxPrice?: number

  @ApiPropertyOptional({ description: 'Diện tích tối thiểu (m²)' })
  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  minArea?: number

  @ApiPropertyOptional({ description: 'Diện tích tối đa (m²)' })
  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  maxArea?: number

  @ApiPropertyOptional({ description: 'Số phòng ngủ' })
  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  bedrooms?: number

  @ApiPropertyOptional({ description: 'Số phòng tắm' })
  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  bathrooms?: number

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

  @ApiPropertyOptional({ description: 'Loại giá điện' })
  @IsString()
  @IsOptional()
  electricity?: string

  @ApiPropertyOptional({ description: 'Loại giá nước' })
  @IsString()
  @IsOptional()
  water?: string

  @ApiPropertyOptional({ description: 'Loại giá internet' })
  @IsString()
  @IsOptional()
  internet?: string

  @ApiPropertyOptional({ description: 'Chỉ hiển thị căn hộ đã kiểm duyệt' })
  @IsBoolean()
  @IsOptional()
  @Type(() => Boolean)
  isVerified?: boolean

  @ApiPropertyOptional({
    description: 'Chỉ hiển thị căn hộ có ảnh/video/360/VR',
  })
  @IsBoolean()
  @IsOptional()
  @Type(() => Boolean)
  hasMedia?: boolean

  @ApiPropertyOptional({
    description: 'Danh sách tiện ích (ngăn cách bằng dấu phẩy)',
  })
  @IsString()
  @IsOptional()
  amenities?: string
}
