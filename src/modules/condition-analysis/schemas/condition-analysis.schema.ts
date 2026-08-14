import {
  Column,
  CreateDateColumn,
  Entity,
  ObjectId,
  ObjectIdColumn,
} from 'typeorm'

export type ConditionFindingStatus = 'detected' | 'uncertain' | 'not_detected'

export type OverallCondition = 'good' | 'attention_needed' | 'uncertain'

export interface NormalizedBoundingBox {
  x: number
  y: number
  width: number
  height: number
}

export interface ConditionFinding {
  label: string
  status: ConditionFindingStatus
  confidence: number
  description: string
  boundingBox: NormalizedBoundingBox | null
}

@Entity('condition_analyses')
export class ConditionAnalysis {
  @ObjectIdColumn()
  _id!: ObjectId

  @Column()
  userId!: string

  @Column()
  apartmentId!: string

  @Column()
  imageUrl!: string

  @Column()
  imageStorageKey!: string

  @Column()
  findings!: ConditionFinding[]

  @Column()
  overallCondition!: OverallCondition

  @Column({ default: [] })
  checklist!: string[]

  @Column()
  model!: string

  @Column({ default: true })
  isPrivate!: boolean

  @CreateDateColumn()
  createdAt!: Date
}
