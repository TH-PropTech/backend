import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import type {
  ConditionFindingStatus,
  OverallCondition,
} from '../schemas/condition-analysis.schema'

export class NormalizedBoundingBoxDto {
  @ApiProperty({ minimum: 0, maximum: 1 })
  x!: number

  @ApiProperty({ minimum: 0, maximum: 1 })
  y!: number

  @ApiProperty({ minimum: 0, maximum: 1 })
  width!: number

  @ApiProperty({ minimum: 0, maximum: 1 })
  height!: number
}

export class ConditionFindingDto {
  @ApiProperty()
  label!: string

  @ApiProperty({ enum: ['detected', 'uncertain', 'not_detected'] })
  status!: ConditionFindingStatus

  @ApiProperty({ minimum: 0, maximum: 1 })
  confidence!: number

  @ApiProperty()
  description!: string

  @ApiPropertyOptional({ type: NormalizedBoundingBoxDto, nullable: true })
  boundingBox!: NormalizedBoundingBoxDto | null
}

export class AnalysisResponseDto {
  @ApiProperty()
  _id!: string

  @ApiProperty()
  apartmentId!: string

  @ApiProperty()
  imageUrl!: string

  @ApiProperty({ type: ConditionFindingDto, isArray: true })
  findings!: ConditionFindingDto[]

  @ApiProperty({ enum: ['good', 'attention_needed', 'uncertain'] })
  overallCondition!: OverallCondition

  @ApiProperty({ type: String, isArray: true })
  checklist!: string[]

  @ApiProperty()
  model!: string

  @ApiProperty()
  createdAt!: Date
}
