import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ObjectId,
  ObjectIdColumn,
} from 'typeorm'

/** Phân loại bản ghi kiểm toán cấu hình; mọi truy vấn đọc bắt buộc lọc theo scope. */
export type ConfigAuditScope =
  | 'contract-layout'
  | 'contract-template'
  | 'platform-fee'
  | 'rental-flow'

/**
 * Kiểm toán thay đổi cấu hình quản trị (chỉ ghi nối đuôi, không sửa/xóa).
 * Hợp nhất ContractLayoutAudit, ContractTemplateAudit, PlatformFeeAudit, RentalFlowAudit.
 * `key` = profileKey | templateKey | scheduleId | targetId tùy `scope`.
 *
 * @deprecated G-AUD: đã chuyển sang `ActivityLog` với `kind: 'config-audit'` (`activity_logs`,
 * migration 031). Lớp này chỉ còn làm kiểu của hình JSON cũ (`ConfigAuditService`, mapper);
 * không đăng ký `forFeature`. Collection `config_audits` không bị xóa.
 */
@Entity('config_audits')
@Index(['scope', 'key', 'version', 'createdAt'])
@Index(['scope', 'createdAt'])
export class ConfigAudit {
  @ObjectIdColumn()
  _id!: ObjectId

  @Column({ type: 'string' })
  scope!: ConfigAuditScope

  @Column()
  key!: string

  @Column({ nullable: true })
  version?: number | null

  @Column()
  action!: string

  @Column()
  actorId!: string

  @Column({ nullable: true })
  reason?: string | null

  @Column({ nullable: true })
  beforeHash?: string | null

  @Column({ nullable: true })
  afterHash?: string | null

  /** Chỉ dùng cho scope `rental-flow` (profile | assignment | contract | execution-policy). */
  @Column({ nullable: true })
  targetType?: string | null

  /** Trường riêng theo scope: deniedField, reviewReference, metadata, changedFields, hoặc details của rental-flow. */
  @Column('json', { nullable: true })
  details?: Record<string, unknown> | null

  @CreateDateColumn()
  createdAt!: Date
}
