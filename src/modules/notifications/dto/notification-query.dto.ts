import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsOptional, IsString } from 'class-validator'
import { Type } from 'class-transformer'

export class NotificationQueryDto {
  @ApiPropertyOptional({
    description: 'Lọc theo trạng thái đã đọc ("true" hoặc "false")',
  })
  @IsOptional()
  @IsString()
  isRead?: string

  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @Type(() => Number)
  @IsOptional()
  page?: number = 1

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @Type(() => Number)
  @IsOptional()
  limit?: number = 20
}
