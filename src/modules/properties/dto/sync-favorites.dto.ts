import { ApiProperty } from '@nestjs/swagger'
import { IsArray, IsString } from 'class-validator'

export class SyncFavoritesDto {
  @ApiProperty({
    description:
      'Danh sách ID căn hộ từ guest / thiết bị cần đồng bộ vào tài khoản',
    type: [String],
    example: ['661000000000000000000001', '661000000000000000000002'],
  })
  @IsArray()
  @IsString({ each: true })
  apartmentIds!: string[]
}
