import {
  Entity,
  ObjectIdColumn,
  ObjectId,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm'

export type AlertFrequency = 'instant' | 'daily' | 'weekly'

export interface SavedSearchFilters {
  city?: string
  district?: string
  ward?: string
  minPrice?: number
  maxPrice?: number
  minArea?: number
  maxArea?: number
  bedrooms?: number
  bathrooms?: number
  amenities?: string[]
  furniture?: string
  moveInTime?: string
  petFriendly?: boolean
  category?: string
}

/**
 * @deprecated G-SAV: đã hợp nhất vào `SavedSearchRecord` (kind 'search', collection
 * `user_searches`); giữ lại để đọc collection cũ và migration 016. Không đăng ký
 * forFeature, không ghi mới. `SavedSearchFilters` và `AlertFrequency` vẫn dùng chung.
 */
@Entity('saved_searches')
export class SavedSearch {
  @ObjectIdColumn()
  _id!: ObjectId

  @Column()
  userId!: string

  @Column()
  name!: string

  @Column()
  filters!: SavedSearchFilters

  @Column({ default: true })
  alertEnabled!: boolean

  @Column({ default: 'daily' })
  alertFrequency!: AlertFrequency

  @Column({ nullable: true })
  lastAlertSentAt?: Date

  @Column({ default: 0 })
  matchCount!: number

  @CreateDateColumn()
  createdAt!: Date

  @UpdateDateColumn()
  updatedAt!: Date
}
