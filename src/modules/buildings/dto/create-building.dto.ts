import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  IsArray,
} from 'class-validator'
import { Type } from 'class-transformer'

export class CreateBuildingDto {
  @ApiProperty({ description: 'Tên tòa nhà' })
  @IsString()
  @IsNotEmpty()
  name!: string

  @ApiPropertyOptional({ description: 'ID dự án' })
  @IsString()
  @IsOptional()
  projectId?: string | null

  @ApiPropertyOptional({ description: 'Tên dự án' })
  @IsString()
  @IsOptional()
  projectName?: string | null

  @ApiPropertyOptional({ description: 'Mô tả tòa nhà' })
  @IsString()
  @IsOptional()
  description?: string

  @ApiPropertyOptional({ description: 'Số tầng' })
  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  floorsCount?: number

  @ApiPropertyOptional({ description: 'Địa chỉ/Vị trí' })
  @IsString()
  @IsOptional()
  location?: string

  @ApiPropertyOptional({ description: 'Thành phố' })
  @IsString()
  @IsOptional()
  city?: string

  @ApiPropertyOptional({ description: 'Quận/Huyện' })
  @IsString()
  @IsOptional()
  district?: string

  @ApiPropertyOptional({ description: 'Tiện ích' })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  amenities?: string[]

  @ApiPropertyOptional({ description: 'Hình ảnh' })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  images?: string[]

  @ApiPropertyOptional({ description: 'Hình ảnh 360' })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  images360?: string[]
}
