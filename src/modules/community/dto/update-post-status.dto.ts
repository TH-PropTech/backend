import { ApiProperty } from '@nestjs/swagger'
import { IsEnum } from 'class-validator'

export class UpdatePostStatusDto {
  @ApiProperty({ enum: ['approved', 'rejected'] })
  @IsEnum(['approved', 'rejected'])
  status!: 'approved' | 'rejected'
}
