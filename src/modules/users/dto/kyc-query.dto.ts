import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsOptional, IsIn, IsString } from 'class-validator'
import { Type } from 'class-transformer'

export class KycQueryDto {
  @ApiPropertyOptional({
    enum: ['pending', 'verified', 'rejected'],
    description: 'Lọc theo trạng thái KYC',
  })
  @IsOptional()
  @IsIn(['pending', 'verified', 'rejected'])
  status?: 'pending' | 'verified' | 'rejected'

  @ApiPropertyOptional({ description: 'Tìm kiếm theo tên hoặc số CCCD' })
  @IsOptional()
  @IsString()
  search?: string

  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @Type(() => Number)
  @IsOptional()
  page?: number = 1

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @Type(() => Number)
  @IsOptional()
  limit?: number = 20
}
