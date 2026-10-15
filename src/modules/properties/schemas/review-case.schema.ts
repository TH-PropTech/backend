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
  ListingReviewStatus,
  ListingReviewType,
} from './listing-review-case.schema'
import type {
  SafetyReportCategory,
  SafetyReportRiskLevel,
  SafetyReportStatus,
  SafetyReportTargetType,
} from '../insights/schemas/safety-report.schema'

/** Phân loại hàng đợi kiểm duyệt; mọi truy vấn bắt buộc lọc theo kind. */
export type ReviewCaseKind = 'listing' | 'safety'

/**
 * Hàng đợi kiểm duyệt hợp nhất: ListingReviewCase (kind 'listing') và
 * SafetyReport (kind 'safety'); giữ `_id` cũ (migration 015).
 *
 * `status` của hai miền khác nhau (ListingReviewStatus / SafetyReportStatus),
 * nên mọi lọc theo `status` PHẢI đi kèm `kind`. Trường riêng của từng loại là
 * tùy chọn; phản hồi ánh xạ về hình cũ và bỏ `kind` (xem review-case.mapper.ts).
 *
 * Chỉ mục: `(kind, status, createdAt)` phục vụ hàng đợi và "báo cáo của tôi".
 * Hai entity cũ không có unique/TTL nên không cần tái tạo unique nào.
 */
@Entity('review_cases')
// Tên trùng migration 015 (REVIEW_CASE_INDEXES).
@Index('review_cases_kind_status_created_at', ['kind', 'status', 'createdAt'])
export class ReviewCase {
  @ObjectIdColumn()
  _id!: ObjectId

  @Column({ type: 'string' })
  kind!: ReviewCaseKind

  @Column({ type: 'string' })
  status!: ListingReviewStatus | SafetyReportStatus

  // --- Trường riêng của kind='listing' ---

  @Column({ nullable: true })
  apartmentId?: string

  @Column({ nullable: true })
  type?: ListingReviewType

  @Column({ nullable: true })
  confidence?: number

  @Column({ nullable: true })
  relatedApartmentId?: string | null

  @Column({ nullable: true })
  evidence?: string

  @Column({ nullable: true })
  reviewedBy?: string | null

  @Column({ nullable: true })
  reviewedAt?: Date | null

  // --- Trường riêng của kind='safety' ---

  @Column({ nullable: true })
  reporterId?: string

  @Column({ nullable: true })
  reporterRole?: string

  @Column({ nullable: true })
  targetType?: SafetyReportTargetType

  @Column({ nullable: true })
  targetId?: string

  @Column({ nullable: true })
  targetTitle?: string

  @Column({ nullable: true })
  category?: SafetyReportCategory

  @Column({ nullable: true })
  description?: string

  @Column('array', { nullable: true })
  evidenceUrls?: string[]

  @Column({ nullable: true })
  riskLevel?: SafetyReportRiskLevel

  @Column({ nullable: true })
  resolutionCode?: string

  @Column({ nullable: true })
  resolutionNote?: string

  @Column({ nullable: true })
  assignedTo?: string

  @Column({ nullable: true })
  assignedAt?: Date

  @Column({ nullable: true })
  resolvedBy?: string

  @Column({ nullable: true })
  resolvedAt?: Date

  @Column({ nullable: true })
  isTargetHidden?: boolean

  @Column({ nullable: true })
  appealReason?: string

  @Column({ nullable: true })
  appealedAt?: Date

  @CreateDateColumn()
  createdAt!: Date

  @UpdateDateColumn()
  updatedAt!: Date
}
