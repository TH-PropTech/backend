import {
  Column,
  CreateDateColumn,
  Entity,
  ObjectId,
  ObjectIdColumn,
  Index,
} from 'typeorm'

/**
 * @deprecated Đã hợp nhất vào `ConfigAudit` (scope 'platform-fee') trong activity-log; giữ lại để đọc collection cũ và migration 010. Không đăng ký forFeature, không ghi mới.
 */
@Entity('platform_fee_audits')
@Index(['scheduleId', 'createdAt'])
export class PlatformFeeAudit {
  @ObjectIdColumn() _id!: ObjectId
  @Column() scheduleId!: string
  @Column() version!: number
  @Column() action!: string
  @Column() actorId!: string
  @Column() reason!: string
  @Column('json') changedFields!: string[]
  @Column({ nullable: true }) beforeHash?: string | null
  @Column({ nullable: true }) afterHash?: string | null
  @CreateDateColumn() createdAt!: Date
}
