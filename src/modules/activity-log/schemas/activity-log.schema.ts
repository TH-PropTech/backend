import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ObjectId,
  ObjectIdColumn,
  UpdateDateColumn,
} from 'typeorm'

/**
 * Phân loại bản ghi `activity_logs`. Mọi truy vấn đọc bắt buộc lọc theo `kind`.
 * - `http`: nhật ký thao tác API (ActivityLog cũ)
 * - `job-run`: lịch sử lần chạy job nền (JobRunHistory cũ)
 * - `recommendation`: tập huấn luyện gợi ý (RecommendationHistory cũ)
 * - `blockchain`: nhật ký sổ cái/mô phỏng Fabric (BlockchainLog cũ)
 * - `ai-consultation`: phiên tư vấn AI (AiConsultationLog cũ)
 * - `config-audit`: kiểm toán cấu hình quản trị (ConfigAudit cũ, 4 scope)
 */
export const ACTIVITY_LOG_KINDS = [
  'http',
  'job-run',
  'recommendation',
  'blockchain',
  'ai-consultation',
  'config-audit',
] as const
export type ActivityLogKind = (typeof ACTIVITY_LOG_KINDS)[number]

/**
 * Nhật ký chung, gom 6 loại (xem `kind`). Mỗi `kind` chỉ dùng tập cột của nó;
 * cột không thuộc loại để trống. Hình JSON cũ của từng loại được khôi phục
 * bằng mapper (`utils/legacy-log.mapper.ts`), không lộ `kind` ra API.
 * Hai cột dùng chung giữa loại: `status`, `result`, `userId`, `duration`.
 */
@Entity('activity_logs')
@Index(['createdAt'])
@Index(['userId', 'createdAt'])
@Index('activity_logs_kind_created_at', ['kind', 'createdAt'])
@Index('activity_logs_kind_user_created_at', ['kind', 'userId', 'createdAt'])
@Index('activity_logs_kind_job_started', ['kind', 'jobName', 'startedAt'])
@Index('activity_logs_kind_contract_created', [
  'kind',
  'contractId',
  'createdAt',
])
@Index('activity_logs_kind_payment_created', ['kind', 'paymentId', 'createdAt'])
@Index('activity_logs_kind_deposit_created', ['kind', 'depositId', 'createdAt'])
@Index('activity_logs_kind_governance_created', [
  'kind',
  'governanceSnapshotId',
  'createdAt',
])
@Index('activity_logs_kind_tx_hash', ['kind', 'txHash'])
@Index('activity_logs_kind_log_id', ['kind', 'logId'])
@Index('activity_logs_kind_scope_key_version_created', [
  'kind',
  'scope',
  'key',
  'version',
  'createdAt',
])
@Index('activity_logs_kind_scope_created', ['kind', 'scope', 'createdAt'])
export class ActivityLog {
  @ObjectIdColumn() _id!: ObjectId

  @Column({ type: 'string' }) kind!: ActivityLogKind

  // ---- http: nhật ký thao tác trên API ghi dữ liệu ----
  /** _id của user thực hiện hành động (http) / user phiên AI (ai-consultation, có thể null) */
  @Column({ nullable: true }) userId?: string | null
  /** Vai trò của user tại thời điểm thao tác */
  @Column({ nullable: true }) userRole?: string
  /** HTTP method: POST | PUT | PATCH | DELETE */
  @Column({ nullable: true }) method?: string
  /** Đường dẫn endpoint */
  @Column({ nullable: true }) path?: string
  /** Mô tả hành động ngắn gọn (http, blockchain) */
  @Column({ nullable: true }) action?: string
  @Column({ nullable: true }) statusCode?: number
  /** Body gửi lên (đã loại bỏ trường nhạy cảm) */
  @Column({ nullable: true }) requestBody?: Record<string, unknown>
  @Column({ nullable: true }) responseMessage?: string
  @Column({ nullable: true }) ip?: string
  @Column({ nullable: true }) userAgent?: string
  /** Đối tượng bị tác động */
  @Column({ nullable: true }) targetInfo?: Record<string, unknown>
  /** Thời gian xử lý (ms) (http); cũng là `duration` của ai-consultation */
  @Column({ nullable: true }) duration?: number

  // ---- job-run ----
  @Column({ nullable: true }) jobName?: string
  @Column({ nullable: true }) trigger?: string
  @Column({ nullable: true }) startedAt?: Date
  @Column({ nullable: true }) finishedAt?: Date | null
  @Column({ nullable: true }) durationMs?: number | null
  @Column({ nullable: true }) error?: string | null

  /** job-run: kết quả job; ai-consultation: kết luận tư vấn */
  @Column({ nullable: true }) result?: unknown

  /** job-run: running|success|error; blockchain: pending|confirmed|failed; ai-consultation: trạng thái phiên */
  @Column({ nullable: true }) status?: string

  // ---- recommendation (tập huấn luyện) ----
  @Column({ nullable: true }) userAge?: number
  @Column({ nullable: true }) userIncome?: number
  @Column({ nullable: true }) preferredDistrict?: string
  @Column({ nullable: true }) preferredBedrooms?: number
  @Column({ nullable: true }) requiresGym?: number
  @Column({ nullable: true }) requiresParking?: number
  @Column({ nullable: true }) rentedApartmentId?: string
  @Column({ nullable: true }) satisfactionScore?: number

  // ---- blockchain ----
  @Column({ nullable: true }) contractId?: string | null
  @Column({ nullable: true }) paymentId?: string | null
  @Column({ nullable: true }) depositId?: string | null
  @Column({ nullable: true }) governanceSnapshotId?: string | null
  @Column({ nullable: true }) settlementId?: string | null
  @Column({ nullable: true, type: 'int' }) handoverRevision?: number | null
  @Column({ nullable: true, type: 'int' }) schemaVersion?: number | null
  @Column({ nullable: true }) payloadHash?: string | null
  @Column({ nullable: true }) eventType?: string
  @Column({ nullable: true }) networkMode?: string
  @Column({ nullable: true }) retryCount?: number | null
  @Column({ nullable: true }) txHash?: string
  @Column({ nullable: true, type: 'int' }) blockNumber?: number | null
  @Column({ nullable: true }) network?: string
  @Column({ nullable: true }) details?: Record<string, unknown>

  // ---- ai-consultation ----
  @Column({ nullable: true }) logId?: string
  /** Trần số tin nhắn được quản lý ở service (xem AI_CONSULTATION_MAX_MESSAGES) */
  @Column('json', { nullable: true }) messages?: Array<{
    role: 'user' | 'assistant' | 'system'
    content: string
    timestamp: Date
  }>
  @Column({ nullable: true }) recommendedPackage?: string | null
  @Column({ nullable: true }) notes?: string | null
  @Column({ nullable: true }) systemPrompt?: string | null

  // ---- config-audit (hợp nhất từ ConfigAudit; `action`, `details`, `createdAt` dùng chung) ----
  /** config-audit: contract-layout | contract-template | platform-fee | rental-flow */
  @Column({ nullable: true }) scope?: string
  /** config-audit: profileKey | templateKey | scheduleId | targetId tùy scope */
  @Column({ nullable: true }) key?: string
  /** config-audit: phiên bản đối tượng (có thể trống) */
  @Column({ nullable: true }) version?: number | null
  /** config-audit: người thực hiện thao tác (userId của loại http có nghĩa khác) */
  @Column({ nullable: true }) actorId?: string
  @Column({ nullable: true }) reason?: string | null
  @Column({ nullable: true }) beforeHash?: string | null
  @Column({ nullable: true }) afterHash?: string | null
  /** config-audit (rental-flow): profile | assignment | contract | execution-policy */
  @Column({ nullable: true }) targetType?: string | null

  @CreateDateColumn() createdAt!: Date
  @UpdateDateColumn() updatedAt!: Date
}
