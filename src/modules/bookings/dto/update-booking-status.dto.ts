import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsIn, IsOptional, IsString } from 'class-validator'

export class UpdateBookingStatusDto {
  @ApiProperty({
    enum: ['confirmed', 'rejected', 'completed'],
    description: 'Chủ nhà xác nhận, từ chối hoặc hoàn thành lịch hẹn',
  })
  @IsIn(['confirmed', 'rejected', 'completed'])
  status!: 'confirmed' | 'rejected' | 'completed'

  @ApiPropertyOptional({ description: 'Lý do từ chối (bắt buộc khi rejected)' })
  @IsOptional()
  @IsString()
  rejectedReason?: string
}
