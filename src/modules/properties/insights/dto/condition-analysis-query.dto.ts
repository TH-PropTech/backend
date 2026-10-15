import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsMongoId, IsOptional } from 'class-validator'

export class ConditionAnalysisQueryDto {
  @ApiPropertyOptional({ description: 'Filter records by apartment' })
  @IsOptional()
  @IsMongoId()
  apartmentId?: string
}
