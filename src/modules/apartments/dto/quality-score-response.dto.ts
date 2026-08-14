import { ApiProperty } from '@nestjs/swagger'
import type { ChecklistItem, ScoreBreakdown } from '../listing-quality.service'

export class QualityScoreResponseDto {
  @ApiProperty({ minimum: 0, maximum: 100 }) score!: number
  @ApiProperty({ example: 100 }) maxScore!: 100
  @ApiProperty({ enum: ['excellent', 'good', 'fair', 'poor'] }) grade!:
    | 'excellent'
    | 'good'
    | 'fair'
    | 'poor'
  @ApiProperty({ type: [Object] }) breakdown!: ScoreBreakdown[]
  @ApiProperty({ type: [Object] }) checklist!: ChecklistItem[]
}
