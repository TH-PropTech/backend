import {
  IsNumber,
  IsString,
  IsBoolean,
  IsOptional,
  Min,
  Max,
  IsEnum,
} from 'class-validator'
import { ApiProperty } from '@nestjs/swagger'

export enum FeedbackType {
  LIKE = 'like',
  DISLIKE = 'dislike',
}

export class FeedbackDto {
  @ApiProperty({
    example: '60d5ec4b8f72a43b64f78e47',
    description: 'ID của căn hộ',
  })
  @IsString()
  apartment_id!: string

  @ApiProperty({ example: 28, description: 'Tuổi của khách hàng' })
  @IsNumber()
  @Min(18)
  @Max(100)
  age!: number

  @ApiProperty({ example: 35000000, description: 'Thu nhập hàng tháng (VND)' })
  @IsNumber()
  @Min(0)
  income!: number

  @ApiProperty({ example: 'Quận 7', description: 'Quận mong muốn' })
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

  @ApiProperty({
    example: 'like',
    enum: FeedbackType,
    description: 'Loại phản hồi (like hoặc dislike)',
  })
  @IsEnum(FeedbackType)
  feedback_type!: FeedbackType
}
