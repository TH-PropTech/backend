import { ApiProperty } from '@nestjs/swagger'
import { ArrayMaxSize, IsArray, IsString, Matches } from 'class-validator'

export const NAV_TAB_ID_PATTERN = /^[a-z0-9-]{1,40}$/
export const MAX_HIDDEN_NAV_TABS = 64

export class UpdateNavConfigDto {
  @ApiProperty({
    type: [String],
    description:
      'Id các mục menu bị ẩn với nhân viên. Id lạ được lưu nhưng giao diện bỏ qua.',
    example: ['community', 'safety-reports'],
  })
  @IsArray()
  @ArrayMaxSize(MAX_HIDDEN_NAV_TABS)
  @IsString({ each: true })
  @Matches(NAV_TAB_ID_PATTERN, { each: true })
  hiddenForStaff!: string[]
}
