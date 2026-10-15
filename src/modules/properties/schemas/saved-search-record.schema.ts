import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ObjectId,
  ObjectIdColumn,
  UpdateDateColumn,
} from 'typeorm'
import type { AlertFrequency, SavedSearchFilters } from './saved-search.schema'
import type { AlertTriggerType } from './search-alert.schema'

/** Phân loại bản ghi: 'search' = bộ lọc đã lưu, 'alert' = cảnh báo. Mọi truy vấn bắt buộc lọc theo kind. */
export type SavedSearchRecordKind = 'search' | 'alert'

export const USER_SEARCHES_COLLECTION = 'user_searches'

/**
 * G-SAV: hợp nhất `SavedSearch` (kind 'search') và `SearchAlert` (kind 'alert') vào
 * một collection `user_searches`, GIỮ `_id` cũ của từng bản ghi (migration 016) để
 * `SearchAlert.savedSearchId` và khóa khử trùng `deduplicationKey` vẫn đúng.
 *
 * Trường riêng của từng kind là tùy chọn: search (name, filters, alertEnabled,
 * alertFrequency, lastAlertSentAt, matchCount), alert (savedSearchId, apartmentId,
 * apartmentTitle, triggerType, matchReason, previousValue, newValue, isRead,
 * isDismissed, deduplicationKey). Không đặt default cho trường riêng để bản ghi
 * alert không bị thêm trường search. Phản hồi API ánh xạ về hình cũ (không có
 * `kind`), xem `saved-search-record.mapper.ts`.
 *
 * Chỉ mục (TypeORM khai báo ở đây, migration 016 tạo khi áp dụng):
 * - `(kind, alertEnabled)`: quét search đang bật cảnh báo khi căn hộ đổi trạng thái/giá;
 * - `(kind, userId, createdAt)`: danh sách theo người dùng;
 * - `(kind, deduplicationKey)`: tra khử trùng cảnh báo.
 * Không có unique nào ở hai entity cũ nên không tạo unique mới.
 */
@Entity(USER_SEARCHES_COLLECTION)
// Tên trùng migration 016 (SAVED_SEARCH_RECORD_INDEXES).
@Index('user_searches_kind_alertEnabled', ['kind', 'alertEnabled'])
@Index('user_searches_kind_userId_createdAt', ['kind', 'userId', 'createdAt'])
@Index('user_searches_kind_deduplicationKey', ['kind', 'deduplicationKey'])
export class SavedSearchRecord {
  @ObjectIdColumn()
  _id!: ObjectId

  @Column({ type: 'string' })
  kind!: SavedSearchRecordKind

  @Column()
  userId!: string

  // --- Trường riêng của kind='search' ---

  @Column({ nullable: true })
  name?: string

  @Column({ nullable: true })
  filters?: SavedSearchFilters

  @Column({ nullable: true })
  alertEnabled?: boolean

  @Column({ nullable: true })
  alertFrequency?: AlertFrequency

  @Column({ nullable: true })
  lastAlertSentAt?: Date

  @Column({ nullable: true })
  matchCount?: number

  // --- Trường riêng của kind='alert' ---

  @Column({ nullable: true })
  savedSearchId?: string

  @Column({ nullable: true })
  apartmentId?: string

  @Column({ nullable: true })
  apartmentTitle?: string

  @Column({ nullable: true })
  triggerType?: AlertTriggerType

  @Column({ nullable: true })
  matchReason?: string

  @Column({ nullable: true })
  previousValue?: string

  @Column({ nullable: true })
  newValue?: string

  @Column({ nullable: true })
  isRead?: boolean

  @Column({ nullable: true })
  isDismissed?: boolean

  @Column({ nullable: true })
  deduplicationKey?: string

  @CreateDateColumn()
  createdAt!: Date

  @UpdateDateColumn()
  updatedAt!: Date
}
