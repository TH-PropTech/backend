import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsIn, IsOptional, IsString } from 'class-validator'

export class ReviewKycDto {
  @ApiProperty({
    enum: ['verified', 'rejected'],
    description: 'Kết quả duyệt KYC',
  })
  @IsIn(['verified', 'rejected'])
  status!: 'verified' | 'rejected'

  @ApiPropertyOptional({ description: 'Lý do từ chối (bắt buộc khi rejected)' })
  @IsOptional()
  @IsString()
  rejectedReason?: string
}
