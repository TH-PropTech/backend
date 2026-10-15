import {
  Entity,
  ObjectIdColumn,
  ObjectId,
  Column,
  CreateDateColumn,
} from 'typeorm'

export type AlertTriggerType =
  | 'new_listing'
  | 'price_change'
  | 'status_change'
  | 'expiring_soon'

/**
 * @deprecated G-SAV: đã hợp nhất vào `SavedSearchRecord` (kind 'alert', collection
 * `user_searches`); giữ lại để đọc collection cũ và migration 016. Không đăng ký
 * forFeature, không ghi mới. `AlertTriggerType` vẫn dùng chung.
 */
@Entity('search_alerts')
export class SearchAlert {
  @ObjectIdColumn()
  _id!: ObjectId

  @Column()
  savedSearchId!: string

  @Column()
  userId!: string

  @Column()
  apartmentId!: string

  @Column()
  apartmentTitle!: string

  @Column()
  triggerType!: AlertTriggerType

  @Column()
  matchReason!: string

  @Column({ nullable: true })
  previousValue?: string

  @Column({ nullable: true })
  newValue?: string

  @Column({ default: false })
  isRead!: boolean

  @Column({ default: false })
  isDismissed!: boolean

  @Column()
  deduplicationKey!: string

  @CreateDateColumn()
  createdAt!: Date
}
