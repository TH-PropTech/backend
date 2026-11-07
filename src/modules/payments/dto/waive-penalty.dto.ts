import { ApiProperty } from '@nestjs/swagger'
import { IsString, MaxLength } from 'class-validator'

export class WaivePenaltyDto {
  @ApiProperty({
    description:
      'Lý do chủ nhà miễn khoản lãi chậm trả (bắt buộc, tối đa 500 ký tự)',
    maxLength: 500,
  })
  @IsString()
  @MaxLength(500)
  reason!: string
}
