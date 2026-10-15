import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsMongoId, IsObject, IsOptional } from 'class-validator'

export class RiskScoreDto {
  @ApiProperty()
  @IsMongoId()
  apartmentId!: string

  @ApiPropertyOptional({
    description:
      'Optional non-negative weights keyed by the exact source layer type',
  })
  @IsOptional()
  @IsObject()
  weights?: Record<string, number>
}
