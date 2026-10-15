import {
  Entity,
  ObjectIdColumn,
  ObjectId,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm'

export type SafetyReportCategory =
  | 'fake_listing'
  | 'external_payment'
  | 'wrong_info'
  | 'harassment'
  | 'spam'
  | 'danger'

export type SafetyReportTargetType = 'listing' | 'user' | 'message'

export type SafetyReportRiskLevel = 'low' | 'medium' | 'high' | 'critical'

export type SafetyReportStatus =
  | 'pending'
  | 'investigating'
  | 'resolved'
  | 'dismissed'
  | 'appealed'

/**
 * @deprecated G-RVC: dữ liệu nay nằm ở `ReviewCase{kind:'safety'}` (collection
 * `review_cases`). Giữ lại làm kiểu hình trả về và để migration 015 / rollback
 * tham chiếu collection cũ `safety_reports`; entity này KHÔNG còn nằm trong
 * `TypeOrmModule.forFeature`.
 */
@Entity('safety_reports')
export class SafetyReport {
  @ObjectIdColumn()
  _id!: ObjectId

  @Column()
  reporterId!: string

  @Column()
  reporterRole!: string

  @Column()
  targetType!: SafetyReportTargetType

  @Column()
  targetId!: string

  @Column({ nullable: true })
  targetTitle?: string

  @Column()
  category!: SafetyReportCategory

  @Column()
  description!: string

  @Column('array')
  evidenceUrls!: string[]

  @Column({ default: 'medium' })
  riskLevel!: SafetyReportRiskLevel

  @Column({ default: 'pending' })
  status!: SafetyReportStatus

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

  @Column({ default: false })
  isTargetHidden!: boolean

  @Column({ nullable: true })
  appealReason?: string

  @Column({ nullable: true })
  appealedAt?: Date

  @CreateDateColumn()
  createdAt!: Date

  @UpdateDateColumn()
  updatedAt!: Date
}
