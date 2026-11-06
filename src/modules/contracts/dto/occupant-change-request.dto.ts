import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Transform, Type } from 'class-transformer'
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator'

export const OCCUPANT_REQUEST_MAX_PEOPLE = 5
export const OCCUPANT_REQUEST_MAX_SURCHARGE = 10_000_000
/** Ảnh JPEG/PNG; kích thước 5 MB do `POST /apartments/upload` giới hạn. */
const IMAGE_URL_PATH = /\.(jpe?g|png)$/i

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value

export class OccupantRequestPersonDto {
  @ApiProperty({ maxLength: 100 })
  @Transform(trim)
  @IsString({ message: 'Vui lòng nhập họ tên người ở.' })
  @IsNotEmpty({ message: 'Vui lòng nhập họ tên người ở.' })
  @MaxLength(100)
  fullName!: string

  @ApiProperty({ minimum: 1900, maximum: 2100 })
  @Type(() => Number)
  @IsInt({ message: 'Vui lòng nhập năm sinh hợp lệ.' })
  @Min(1900, { message: 'Vui lòng nhập năm sinh hợp lệ.' })
  @Max(2100, { message: 'Vui lòng nhập năm sinh hợp lệ.' })
  birthYear!: number

  @ApiProperty({ maxLength: 50 })
  @Transform(trim)
  @IsString({ message: 'Vui lòng nhập quan hệ với người thuê.' })
  @IsNotEmpty({ message: 'Vui lòng nhập quan hệ với người thuê.' })
  @MaxLength(50)
  relationship!: string

  @ApiProperty({ type: [String], minItems: 1, maxItems: 2 })
  @IsArray({ message: 'Vui lòng tải ảnh giấy tờ của người ở.' })
  @ArrayMinSize(1, { message: 'Vui lòng tải ảnh giấy tờ của người ở.' })
  @ArrayMaxSize(2)
  @IsUrl({ protocols: ['https'], require_protocol: true }, { each: true })
  @Matches(IMAGE_URL_PATH, {
    each: true,
    message: 'Ảnh giấy tờ phải là tệp JPEG hoặc PNG.',
  })
  idPhotoUrls!: string[]
}

export class CreateOccupantRequestDto {
  @ApiProperty({
    type: [OccupantRequestPersonDto],
    maxItems: OCCUPANT_REQUEST_MAX_PEOPLE,
  })
  @IsArray()
  @ArrayMinSize(1, { message: 'Vui lòng thêm ít nhất một người ở.' })
  @ArrayMaxSize(OCCUPANT_REQUEST_MAX_PEOPLE)
  @ValidateNested({ each: true })
  @Type(() => OccupantRequestPersonDto)
  occupants!: OccupantRequestPersonDto[]

  @ApiProperty({ example: '2030-02-01' })
  @IsISO8601({ strict: true }, { message: 'Vui lòng chọn ngày chuyển vào.' })
  moveInDate!: string

  @ApiProperty({ maxLength: 500 })
  @Transform(trim)
  @IsString({ message: 'Vui lòng nhập lý do.' })
  @IsNotEmpty({ message: 'Vui lòng nhập lý do.' })
  @MaxLength(500)
  reason!: string

  @ApiProperty({ minimum: 0, maximum: OCCUPANT_REQUEST_MAX_SURCHARGE })
  @Type(() => Number)
  @IsInt({ message: 'Phụ phí phải là số nguyên (đồng).' })
  @Min(0, { message: 'Phụ phí không được âm.' })
  @Max(OCCUPANT_REQUEST_MAX_SURCHARGE, {
    message: 'Phụ phí vượt mức cho phép.',
  })
  proposedSurcharge!: number
}

export class OccupantRequestDecisionDto {
  @ApiProperty({ enum: ['approve', 'reject', 'counter'] })
  @IsIn(['approve', 'reject', 'counter'])
  action!: 'approve' | 'reject' | 'counter'

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  reason?: string

  @ApiPropertyOptional({ minimum: 0, maximum: OCCUPANT_REQUEST_MAX_SURCHARGE })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(OCCUPANT_REQUEST_MAX_SURCHARGE)
  counterSurcharge?: number
}

export class OccupantRequestCounterResponseDto {
  @ApiProperty()
  @IsBoolean()
  accept!: boolean
}
