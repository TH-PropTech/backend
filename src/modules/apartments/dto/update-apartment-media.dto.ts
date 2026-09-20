import { ApiPropertyOptional } from '@nestjs/swagger'
import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  ValidateIf,
} from 'class-validator'

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

  @ApiPropertyOptional({
    description: 'Liên kết VR Tour (Matterport…) do nhân viên gắn',
  })
  @IsString()
  @MaxLength(2048)
  // Chuỗi rỗng = gỡ link. Chỉ nhận https để không lưu javascript:/data: URL sẽ được render thành link/iframe.
  @ValidateIf((_object, value: unknown) => value !== '')
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @IsOptional()
  vrUrl?: string
}
