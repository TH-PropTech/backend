import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsOptional, IsEnum } from 'class-validator'
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto'

export class AlertQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ['true', 'false'] })
  @IsOptional()
  @IsEnum(['true', 'false'])
  isRead?: string
}
