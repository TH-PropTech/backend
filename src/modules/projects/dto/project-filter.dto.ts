import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsOptional, IsString, IsNumber } from 'class-validator'
import { Type } from 'class-transformer'

export class ProjectFilterDto {
  @ApiPropertyOptional({
    description: 'Từ khóa tìm kiếm (tên dự án, mô tả, chủ đầu tư, địa điểm)',
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

  @ApiPropertyOptional({
    description: 'Giá tối thiểu của căn hộ thuộc dự án (triệu)',
  })
  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  minPrice?: number

  @ApiPropertyOptional({
    description: 'Giá tối đa của căn hộ thuộc dự án (triệu)',
  })
  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  maxPrice?: number

  @ApiPropertyOptional({ description: 'Số phòng ngủ của căn hộ thuộc dự án' })
  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  bedrooms?: number

  @ApiPropertyOptional({ description: 'Số phòng tắm của căn hộ thuộc dự án' })
  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  bathrooms?: number

  @ApiPropertyOptional({
    description: 'Danh sách tiện ích (ngăn cách bằng dấu phẩy)',
  })
  @IsString()
  @IsOptional()
  amenities?: string
}
