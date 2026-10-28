import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator'
import { Type } from 'class-transformer'

export const MAX_NOTIFICATION_PAGE_SIZE = 50

export class NotificationQueryDto {
  @ApiPropertyOptional({
    description: 'Lọc theo trạng thái đã đọc ("true" hoặc "false")',
    enum: ['true', 'false'],
  })
  @IsOptional()
  @IsIn(['true', 'false'])
  isRead?: string

  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number = 1

  @ApiPropertyOptional({
    minimum: 1,
    maximum: MAX_NOTIFICATION_PAGE_SIZE,
    default: 20,
  })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_NOTIFICATION_PAGE_SIZE)
  limit?: number = 20
}
