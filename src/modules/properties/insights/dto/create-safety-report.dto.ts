import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
  IsArray,
  ArrayMaxSize,
} from 'class-validator'
import type {
  SafetyReportCategory,
  SafetyReportTargetType,
} from '../schemas/safety-report.schema'

export class CreateSafetyReportDto {
  @ApiProperty({ enum: ['listing', 'user', 'message'] })
  @IsEnum(['listing', 'user', 'message'])
  targetType!: SafetyReportTargetType

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  targetId!: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  targetTitle?: string

  @ApiProperty({
    enum: [
      'fake_listing',
      'external_payment',
      'wrong_info',
      'harassment',
      'spam',
      'danger',
    ],
  })
  @IsEnum([
    'fake_listing',
    'external_payment',
    'wrong_info',
    'harassment',
    'spam',
    'danger',
  ])
  category!: SafetyReportCategory

  @ApiProperty({ minLength: 10 })
  @IsString()
  @MinLength(10, { message: 'Mô tả phải có ít nhất 10 ký tự' })
  description!: string

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10, { message: 'Tối đa 10 bằng chứng' })
  @IsString({ each: true })
  evidenceUrls?: string[]
}
