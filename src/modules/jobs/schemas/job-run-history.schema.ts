import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ObjectId,
  ObjectIdColumn,
  UpdateDateColumn,
} from 'typeorm'

export type JobRunStatus = 'running' | 'success' | 'error'
export type JobRunTrigger = 'cron' | 'manual'

/** Lịch sử mỗi lần job nền chạy (bắt đầu / kết thúc / lỗi). */
/**
 * @deprecated G-LOG: gộp vào `ActivityLog` (collection `activity_logs`, `kind: 'job-run'`).
 * Giữ lại để đọc collection cũ và migration 023. Không đăng ký forFeature, không ghi mới.
 */
@Entity('job_run_histories')
@Index(['jobName', 'startedAt'])
export class JobRunHistory {
  @ObjectIdColumn() _id!: ObjectId
  @Column() jobName!: string
  @Column({ type: 'string' }) trigger!: JobRunTrigger
  @Column({ type: 'string', default: 'running' }) status!: JobRunStatus
  @Column() startedAt!: Date
  @Column({ nullable: true }) finishedAt!: Date | null
  @Column({ nullable: true }) durationMs!: number | null
  @Column({ nullable: true }) result!: unknown
  @Column({ nullable: true }) error!: string | null
  @CreateDateColumn() createdAt!: Date
  @UpdateDateColumn() updatedAt!: Date
}
