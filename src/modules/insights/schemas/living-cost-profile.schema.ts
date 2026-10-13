import {
  Entity,
  ObjectIdColumn,
  ObjectId,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm'

export interface EstimateRange {
  type: 'official' | 'estimated'
  low: number
  mid: number
  high: number
}

export interface CommuteEstimate {
  distance?: number
  mode?: string
  monthlyFee?: number
}

export interface OneTimeCostItem {
  name: string
  amount: number
}

export type AffordabilityStatus =
  | 'affordable'
  | 'tight'
  | 'over_budget'
  | 'unknown'
export type ConfidenceLabel = 'high' | 'medium' | 'low'

@Entity('living_cost_profiles')
export class LivingCostProfile {
  @ObjectIdColumn()
  _id!: ObjectId

  @Column()
  userId!: string

  @Column()
  name!: string

  @Column({ nullable: true })
  apartmentId?: string

  @Column()
  monthlyRent!: number

  @Column({ default: 0 })
  serviceFee!: number

  @Column({ default: 0 })
  parkingFee!: number

  @Column({ default: 0 })
  internetFee!: number

  @Column()
  electricityEstimate!: EstimateRange

  @Column()
  waterEstimate!: EstimateRange

  @Column({ nullable: true })
  commuteEstimate?: CommuteEstimate

  @Column('array')
  oneTimeCosts!: OneTimeCostItem[]

  @Column({ default: 1 })
  occupants!: number

  @Column({ nullable: true })
  monthlyBudget?: number

  @Column()
  totalEstimate!: EstimateRange

  @Column({ default: 'unknown' })
  affordabilityStatus!: AffordabilityStatus

  @Column({ default: 'medium' })
  confidenceLabel!: ConfidenceLabel

  @CreateDateColumn()
  createdAt!: Date

  @UpdateDateColumn()
  updatedAt!: Date
}
