import { ApiPropertyOptional } from '@nestjs/swagger'
import { ArrayMaxSize, IsArray, IsOptional, IsString } from 'class-validator'

export class UpdateApartmentMediaDto {
  @ApiPropertyOptional({ description: 'Danh sách ảnh thường thay thế' })
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @IsOptional()
  gallery?: string[]

  @ApiPropertyOptional({ description: 'Danh sách ảnh 360 độ thay thế' })
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @IsOptional()
  images360?: string[]
}
