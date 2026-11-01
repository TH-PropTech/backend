import { IsBoolean } from 'class-validator'
import { ApiProperty } from '@nestjs/swagger'

export class NotificationPreferencesDto {
  @ApiProperty({
    description: 'Bật nhận thông báo qua Email',
    example: true,
  })
  @IsBoolean()
  email!: boolean

  @ApiProperty({
    description:
      'Bật nhận thông báo đẩy qua thiết bị di động (Push notification)',
    example: true,
  })
  @IsBoolean()
  push!: boolean
}
