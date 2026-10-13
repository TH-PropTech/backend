import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator'
import type { SafetyReportStatus } from '../schemas/safety-report.schema'

export class UpdateReportStatusDto {
  @ApiProperty({
    enum: ['investigating', 'resolved', 'dismissed'],
  })
  @IsEnum(['investigating', 'resolved', 'dismissed'])
  status!: Extract<
    SafetyReportStatus,
    'investigating' | 'resolved' | 'dismissed'
  >

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  resolutionCode?: string

  @ApiPropertyOptional({ minLength: 5 })
  @IsOptional()
  @IsString()
  @MinLength(5, { message: 'Ghi chú xử lý phải có ít nhất 5 ký tự' })
  resolutionNote?: string
}

export class AppealReportDto {
  @ApiProperty({ minLength: 10 })
  @IsString()
  @IsNotEmpty()
  @MinLength(10, { message: 'Lý do khiếu nại phải có ít nhất 10 ký tự' })
  appealReason!: string
}
