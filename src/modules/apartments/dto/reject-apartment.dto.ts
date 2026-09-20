import { ApiProperty } from '@nestjs/swagger'
import { IsString, MinLength } from 'class-validator'

export class RejectApartmentDto {
  @ApiProperty({ description: 'Lý do từ chối bài đăng', minLength: 10 })
  @IsString()
  @MinLength(10)
  rejectedReason!: string
}
