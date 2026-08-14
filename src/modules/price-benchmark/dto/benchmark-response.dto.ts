import { ApiProperty } from '@nestjs/swagger'

export type BenchmarkClassification =
  | 'below_market'
  | 'fair_range'
  | 'above_market'
  | 'not_enough_data'

export type BenchmarkConfidence = 'low' | 'medium' | 'high' | 'insufficient'

export class BenchmarkRangeDto {
  @ApiProperty()
  min!: number

  @ApiProperty()
  max!: number
}

export class BenchmarkCriteriaDto {
  @ApiProperty()
  district!: string

  @ApiProperty()
  bedrooms!: number

  @ApiProperty({ nullable: true })
  area!: number | null

  @ApiProperty({ nullable: true })
  furniture!: string | null
}

export class BenchmarkResponseDto {
  @ApiProperty({ nullable: true })
  median!: number | null

  @ApiProperty({ nullable: true })
  p25!: number | null

  @ApiProperty({ nullable: true })
  p75!: number | null

  @ApiProperty({ type: BenchmarkRangeDto, nullable: true })
  range!: BenchmarkRangeDto | null

  @ApiProperty()
  sampleCount!: number

  @ApiProperty()
  excludedOutliers!: number

  @ApiProperty({ enum: ['low', 'medium', 'high', 'insufficient'] })
  confidence!: BenchmarkConfidence

  @ApiProperty({
    enum: ['below_market', 'fair_range', 'above_market', 'not_enough_data'],
  })
  classification!: BenchmarkClassification

  @ApiProperty()
  calculatedAt!: string

  @ApiProperty({ type: BenchmarkCriteriaDto })
  criteria!: BenchmarkCriteriaDto
}
