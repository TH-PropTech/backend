import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsEnum, IsOptional, IsString } from 'class-validator'

export class UpdatePostStatusDto {
  @ApiProperty({ enum: ['approved', 'rejected'] })
  @IsEnum(['approved', 'rejected'])
  status!: 'approved' | 'rejected'

  @ApiPropertyOptional({
    description: 'Lý do từ chối bài viết (khi status = rejected)',
  })
  @IsOptional()
  @IsString()
  rejectReason?: string
}
