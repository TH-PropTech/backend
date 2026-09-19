import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsOptional, IsIn, IsString, IsInt, Min, Max } from 'class-validator'
import { Type } from 'class-transformer'

export class BookingQueryDto {
  @ApiPropertyOptional({
    enum: ['pending', 'confirmed', 'rejected', 'cancelled', 'completed'],
    description: 'Lọc theo trạng thái booking',
  })
  @IsOptional()
  @IsIn(['pending', 'confirmed', 'rejected', 'cancelled', 'completed'])
  status?: 'pending' | 'confirmed' | 'rejected' | 'cancelled' | 'completed'

  @ApiPropertyOptional({ description: 'Lọc theo ID căn hộ' })
  @IsOptional()
  @IsString()
  apartmentId?: string

  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number = 1

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  limit?: number = 20
}
