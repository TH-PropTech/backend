import { ApiProperty } from '@nestjs/swagger'
import { IsString, IsNotEmpty } from 'class-validator'

export class RejectApartmentDto {
  @ApiProperty({ description: 'Lý do từ chối bài đăng' })
  @IsString()
  @IsNotEmpty()
  rejectedReason!: string
}
