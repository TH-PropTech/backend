import { IsOptional, IsString, Matches } from 'class-validator'
import { ApiPropertyOptional } from '@nestjs/swagger'

export const VN_PHONE_REGEX = /^(0|\+84)(3|5|7|8|9)[0-9]{8}$/

export class UpdateUserProfileDto {
  @ApiPropertyOptional({
    description: 'Họ và tên hiển thị',
    example: 'Nguyễn Văn A',
  })
  @IsOptional()
  @IsString()
  fullName?: string

  @ApiPropertyOptional({
    description: 'Số điện thoại Việt Nam hợp lệ',
    example: '0912345678',
  })
  @IsOptional()
  @IsString()
  @Matches(VN_PHONE_REGEX, {
    message: 'Số điện thoại không đúng định dạng Việt Nam',
  })
  phone?: string
}
