import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsEnum, IsOptional } from 'class-validator'
import { PaginationQueryDto } from '../../../../common/dto/pagination-query.dto'
import type {
  SafetyReportCategory,
  SafetyReportStatus,
  SafetyReportRiskLevel,
} from '../schemas/safety-report.schema'

export class SafetyReportQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: ['pending', 'investigating', 'resolved', 'dismissed', 'appealed'],
  })
  @IsOptional()
  @IsEnum(['pending', 'investigating', 'resolved', 'dismissed', 'appealed'])
  status?: SafetyReportStatus

  @ApiPropertyOptional({
    enum: [
      'fake_listing',
      'external_payment',
      'wrong_info',
      'harassment',
      'spam',
      'danger',
    ],
  })
  @IsOptional()
  @IsEnum([
    'fake_listing',
    'external_payment',
    'wrong_info',
    'harassment',
    'spam',
    'danger',
  ])
  category?: SafetyReportCategory

  @ApiPropertyOptional({ enum: ['low', 'medium', 'high', 'critical'] })
  @IsOptional()
  @IsEnum(['low', 'medium', 'high', 'critical'])
  riskLevel?: SafetyReportRiskLevel
}
