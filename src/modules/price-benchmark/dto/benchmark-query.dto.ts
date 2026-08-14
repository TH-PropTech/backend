import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator'

export class BenchmarkQueryDto {
  @ApiProperty({ description: 'Quận/Huyện dùng để chọn mẫu so sánh' })
  @IsString()
  @IsNotEmpty()
  district!: string

  @ApiProperty({ minimum: 0, description: 'Số phòng ngủ' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  bedrooms!: number

  @ApiProperty({ minimum: 1, description: 'Giá thuê cần phân loại (VNĐ)' })
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  priceMonthly!: number

  @ApiPropertyOptional({ minimum: 1, description: 'Diện tích tham chiếu (m²)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  area?: number

  @ApiPropertyOptional({ description: 'Tình trạng nội thất' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  furniture?: string
}
