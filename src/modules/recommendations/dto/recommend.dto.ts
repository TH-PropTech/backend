import {
  IsNumber,
  IsString,
  IsBoolean,
  IsOptional,
  Min,
  Max,
} from 'class-validator'
import { ApiProperty } from '@nestjs/swagger'

export class RecommendDto {
  @ApiProperty({ example: 28, description: 'Tuổi của khách hàng' })
  @IsNumber()
  @Min(18)
  @Max(100)
  age!: number

  @ApiProperty({ example: 35000000, description: 'Thu nhập hàng tháng (VND)' })
  @IsNumber()
  @Min(0)
  income!: number

  @ApiProperty({ example: 'Quận 7', description: 'Quận mong muốn thuê' })
  @IsString()
  preferred_district!: string

  @ApiProperty({ example: 2, description: 'Số phòng ngủ mong muốn' })
  @IsNumber()
  @Min(1)
  rooms!: number

  @ApiProperty({
    example: true,
    required: false,
    description: 'Yêu cầu phòng Gym',
  })
  @IsBoolean()
  @IsOptional()
  has_gym?: boolean

  @ApiProperty({
    example: true,
    required: false,
    description: 'Yêu cầu bãi đỗ xe',
  })
  @IsBoolean()
  @IsOptional()
  has_parking?: boolean
}
