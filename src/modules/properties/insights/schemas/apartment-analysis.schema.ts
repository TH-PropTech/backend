import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ObjectId,
  ObjectIdColumn,
  UpdateDateColumn,
} from 'typeorm'
import type {
  ConditionFinding,
  OverallCondition,
} from './condition-analysis.schema'
import type {
  AffordabilityStatus,
  CommuteEstimate,
  ConfidenceLabel,
  EstimateRange,
  OneTimeCostItem,
} from './living-cost-profile.schema'

export type ApartmentAnalysisKind = 'condition' | 'living-cost'

/**
 * G-ANA: gom `ConditionAnalysis` (kind='condition') và `LivingCostProfile`
 * (kind='living-cost') vào MỘT collection `apartment_analyses`, GIỮ `_id` cũ của
 * từng bản ghi (migration 018; `imageUrl` của phân tích ảnh nhúng chính `_id`).
 *
 * Mọi truy vấn PHẢI lọc `kind`, kể cả truy vấn theo `_id`; phản hồi ánh xạ về hình
 * cũ (không có `kind`/`updatedAt` của loại condition), xem
 * `apartment-analysis.mapper.ts`. `apartmentId` là tùy chọn (chỉ hồ sơ chi phí
 * có thể không gắn căn hộ). Trường riêng của từng loại là tùy chọn ở đây.
 *
 * Chỉ mục: `(kind, userId, createdAt)` khai báo ở đây; không có unique nào.
 */
export const APARTMENT_ANALYSES_COLLECTION = 'apartment_analyses'

@Entity(APARTMENT_ANALYSES_COLLECTION)
// Tên trùng migration 018 (APARTMENT_ANALYSIS_INDEXES).
@Index('apartment_analyses_kind_user_created', ['kind', 'userId', 'createdAt'])
export class ApartmentAnalysis {
  @ObjectIdColumn()
  _id!: ObjectId

  @Column({ type: 'string' })
  kind!: ApartmentAnalysisKind

  @Column()
  userId!: string

  @Column({ nullable: true })
  apartmentId?: string

  // --- Trường riêng của kind='condition' (tùy chọn) ---

  @Column({ nullable: true })
  imageUrl?: string

  @Column({ nullable: true })
  imageStorageKey?: string

  @Column({ nullable: true })
  findings?: ConditionFinding[]

  @Column({ type: 'string', nullable: true })
  overallCondition?: OverallCondition

  @Column({ nullable: true })
  checklist?: string[]

  @Column({ nullable: true })
  model?: string

  @Column({ nullable: true })
  isPrivate?: boolean

  // --- Trường riêng của kind='living-cost' (tùy chọn) ---

  @Column({ nullable: true })
  name?: string

  @Column({ nullable: true })
  monthlyRent?: number

  @Column({ nullable: true })
  serviceFee?: number

  @Column({ nullable: true })
  parkingFee?: number

  @Column({ nullable: true })
  internetFee?: number

  @Column({ nullable: true })
  electricityEstimate?: EstimateRange

  @Column({ nullable: true })
  waterEstimate?: EstimateRange

  @Column({ nullable: true })
  commuteEstimate?: CommuteEstimate

  @Column('array', { nullable: true })
  oneTimeCosts?: OneTimeCostItem[]

  @Column({ nullable: true })
  occupants?: number

  @Column({ nullable: true })
  monthlyBudget?: number

  @Column({ nullable: true })
  totalEstimate?: EstimateRange

  @Column({ type: 'string', nullable: true })
  affordabilityStatus?: AffordabilityStatus

  @Column({ type: 'string', nullable: true })
  confidenceLabel?: ConfidenceLabel

  // --- Chung ---

  @CreateDateColumn()
  createdAt!: Date

  @UpdateDateColumn()
  updatedAt!: Date
}
