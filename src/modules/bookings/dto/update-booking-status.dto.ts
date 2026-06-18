import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsIn, IsOptional, IsString } from 'class-validator'

export class UpdateBookingStatusDto {
  @ApiProperty({
    enum: ['confirmed', 'rejected'],
    description: 'Chủ nhà xác nhận hoặc từ chối lịch hẹn',
  })
  @IsIn(['confirmed', 'rejected'])
  status!: 'confirmed' | 'rejected'

  @ApiPropertyOptional({ description: 'Lý do từ chối (bắt buộc khi rejected)' })
  @IsOptional()
  @IsString()
  rejectedReason?: string
}
