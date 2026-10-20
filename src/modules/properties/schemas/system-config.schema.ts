import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ObjectId,
  ObjectIdColumn,
  UpdateDateColumn,
} from 'typeorm'
import type { CheckResult } from '../../ai/utils/groq-probe'
import type { PlatformFeeScheduleRules } from '../../payments/utils/platform-fee.types'
import type { EngineStrategy } from '../recommendations/engine/naive-bayes.types'

/**
 * Loại cấu hình hệ thống (G-CFG): `job` = bật/tắt job nền, `recommendation` = engine gợi ý,
 * `platform-fee` = phiên bản biểu phí nền tảng, `groq-key` = khóa Groq đã mã hóa,
 * `admin-nav` = mục menu bảng điều khiển bị ẩn với nhân viên.
 */
export type SystemConfigScope =
  | 'job'
  | 'recommendation'
  | 'platform-fee'
  | 'groq-key'
  | 'admin-nav'

/** Trạng thái dùng chung: biểu phí (`draft|published|archived`) và khóa Groq (`active|invalid|disabled`). */
export type SystemConfigStatus =
  | 'draft'
  | 'published'
  | 'archived'
  | 'active'
  | 'invalid'
  | 'disabled'

export const SYSTEM_CONFIGS_COLLECTION = 'system_configs'

/**
 * Cấu hình hệ thống hợp nhất theo `scope` (thay cho `job_configs`,
 * `recommendation_configs`, `platform_fee_schedules`, `groq_api_keys`). Khóa duy nhất là cặp
 * `(scope, key)`: `key` là `jobName` (job), `configId` ('global', recommendation),
 * `scheduleId@version` (platform-fee) và `keyHash` (groq-key).
 *
 * Mọi truy vấn PHẢI lọc theo `scope`. Trường riêng của từng loại là tùy chọn; service/facade
 * ánh xạ về hình cũ (không lộ `scope`/`key` ra API). Khóa bí mật `groq-key` luôn ở dạng mã hóa
 * (`keyEnc`); không bao giờ trả `keyEnc` ra ngoài.
 * Unique theo loại (`scheduleId+version` của platform-fee, `keyHash` của groq-key) là partial
 * index tạo trong migration 022.
 */
@Entity(SYSTEM_CONFIGS_COLLECTION)
// Tên trùng migration 013 (SYSTEM_CONFIG_INDEX) và 022 (SCOPE_KEY_INDEX, cùng tên).
@Index('system_configs_scope_key_unique', ['scope', 'key'], { unique: true })
export class SystemConfig {
  @ObjectIdColumn()
  _id!: ObjectId

  @Column()
  scope!: SystemConfigScope

  @Column()
  key!: string

  /** scope `job`: job có chạy theo lịch không. */
  @Column({ nullable: true })
  enabled?: boolean

  /** scope `recommendation`: chiến lược và siêu tham số của engine. */
  @Column({ nullable: true })
  strategy?: EngineStrategy

  @Column({ nullable: true })
  alpha?: number

  @Column({ nullable: true })
  nbWeight?: number

  @Column({ nullable: true })
  ruleWeight?: number

  /** Email admin cập nhật gần nhất (scope `recommendation`). */
  @Column({ nullable: true })
  updatedBy?: string

  /** scope `admin-nav`: id các mục menu ẩn với nhân viên. */
  @Column('json', { nullable: true })
  hiddenTabs?: string[]

  /** scope `platform-fee`: định danh biểu phí, phiên bản, trạng thái và nội dung. */
  @Column({ nullable: true })
  scheduleId?: string

  @Column({ nullable: true })
  version?: number

  @Column({ nullable: true })
  status?: SystemConfigStatus

  @Column({ nullable: true })
  effectiveFrom?: Date | null

  @Column('json', { nullable: true })
  rules?: PlatformFeeScheduleRules

  @Column({ nullable: true })
  legalReviewStatus?: 'draft' | 'reviewed'

  @Column({ nullable: true })
  reviewReference?: string | null

  @Column({ nullable: true })
  contentHash?: string | null

  @Column({ nullable: true })
  draftRevision?: number

  @Column({ nullable: true })
  createdBy?: string

  @Column({ nullable: true })
  publishedBy?: string | null

  @Column({ nullable: true })
  publishedAt?: Date | null

  /** scope `groq-key`: AES-256-GCM ciphertext và HMAC của khóa (xem groq-key-crypto.ts). */
  @Column({ nullable: true })
  keyEnc?: string

  @Column({ nullable: true })
  keyHash?: string

  @Column({ nullable: true })
  keyMask?: string

  /** Epoch ms; 0 nghĩa là sẵn sàng (scope `groq-key`). */
  @Column({ nullable: true })
  cooldownUntil?: number

  @Column({ nullable: true })
  usageCount?: number

  @Column({ nullable: true })
  failCount?: number

  /** Epoch ms của lần cấp khóa gần nhất (scope `groq-key`). */
  @Column({ nullable: true })
  lastUsedAt?: number

  @Column({ nullable: true })
  lastError?: string

  @Column('json', { nullable: true })
  check?: CheckResult

  @CreateDateColumn()
  createdAt!: Date

  @UpdateDateColumn()
  updatedAt!: Date
}
