import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsString, IsNotEmpty, IsOptional, IsArray } from 'class-validator'

export class CreateProjectDto {
  @ApiProperty({ description: 'Tên dự án' })
  @IsString()
  @IsNotEmpty()
  name!: string

  @ApiProperty({ description: 'Thành phố' })
  @IsString()
  @IsNotEmpty()
  city!: string

  @ApiProperty({ description: 'Quận/Huyện' })
  @IsString()
  @IsNotEmpty()
  district!: string

  @ApiProperty({ description: 'Địa chỉ/Vị trí' })
  @IsString()
  @IsNotEmpty()
  location!: string

  @ApiPropertyOptional({ description: 'Mô tả dự án' })
  @IsString()
  @IsOptional()
  description?: string

  @ApiPropertyOptional({ description: 'Chủ đầu tư' })
  @IsString()
  @IsOptional()
  investor?: string

  @ApiPropertyOptional({ description: 'Tiện ích dự án' })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  amenities?: string[]

  @ApiPropertyOptional({ description: 'Hình ảnh dự án' })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  images?: string[]
}
