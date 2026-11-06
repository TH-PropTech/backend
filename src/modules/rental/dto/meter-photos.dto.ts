import { ApiProperty } from '@nestjs/swagger'
import { ArrayMaxSize, IsArray, IsUrl, Matches } from 'class-validator'

export const METER_PHOTOS_MAX_PER_KIND = 3
/** Ảnh JPEG/PNG; kích thước 5 MB do `POST /apartments/upload` giới hạn. */
const IMAGE_URL_PATH = /\.(jpe?g|png)$/i
const photoRule = { protocols: ['https'], require_protocol: true }

export type MeterPhotos = { electricity: string[]; water: string[] }

export class MeterPhotosDto implements MeterPhotos {
  @ApiProperty({ type: [String], minItems: 0, maxItems: 3 })
  @IsArray({ message: 'Vui lòng tải ảnh công tơ điện.' })
  @ArrayMaxSize(METER_PHOTOS_MAX_PER_KIND, {
    message: 'Tối đa 3 ảnh công tơ điện.',
  })
  @IsUrl(photoRule, { each: true, message: 'Ảnh công tơ điện không hợp lệ.' })
  @Matches(IMAGE_URL_PATH, {
    each: true,
    message: 'Ảnh công tơ điện phải là tệp JPEG hoặc PNG.',
  })
  electricity!: string[]

  @ApiProperty({ type: [String], minItems: 0, maxItems: 3 })
  @IsArray({ message: 'Vui lòng tải ảnh công tơ nước.' })
  @ArrayMaxSize(METER_PHOTOS_MAX_PER_KIND, {
    message: 'Tối đa 3 ảnh công tơ nước.',
  })
  @IsUrl(photoRule, { each: true, message: 'Ảnh công tơ nước không hợp lệ.' })
  @Matches(IMAGE_URL_PATH, {
    each: true,
    message: 'Ảnh công tơ nước phải là tệp JPEG hoặc PNG.',
  })
  water!: string[]
}
