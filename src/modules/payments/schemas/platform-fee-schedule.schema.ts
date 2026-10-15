import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ObjectId,
  ObjectIdColumn,
  UpdateDateColumn,
} from 'typeorm'
import type { PlatformFeeScheduleRules } from '../utils/platform-fee.types'

/**
 * @deprecated G-CFG2: thay bằng `SystemConfig{scope:'platform-fee'}`
 * (`properties/schemas/system-config.schema.ts`, facade `utils/platform-fee-schedule.repository.ts`).
 * Giữ file để migration 022 đọc collection cũ; không đăng ký trong `forFeature`.
 * Collection `platform_fee_schedules` không bị xóa.
 */
@Entity('platform_fee_schedules')
@Index(['scheduleId', 'version'], { unique: true })
@Index(['status', 'effectiveFrom'])
export class PlatformFeeSchedule {
  @ObjectIdColumn() _id!: ObjectId
  @Column() scheduleId!: string
  @Column() version!: number
  @Column({ type: 'string', default: 'draft' }) status!:
    | 'draft'
    | 'published'
    | 'archived'
  @Column({ nullable: true }) effectiveFrom?: Date | null
  @Column('json') rules!: PlatformFeeScheduleRules
  @Column({ type: 'string', default: 'draft' }) legalReviewStatus!:
    | 'draft'
    | 'reviewed'
  @Column({ nullable: true }) reviewReference?: string | null
  @Column({ nullable: true }) contentHash?: string | null
  @Column({ default: 0 }) draftRevision!: number
  @Column() createdBy!: string
  @Column({ nullable: true }) publishedBy?: string | null
  @Column({ nullable: true }) publishedAt?: Date | null
  @CreateDateColumn() createdAt!: Date
  @UpdateDateColumn() updatedAt!: Date
}
