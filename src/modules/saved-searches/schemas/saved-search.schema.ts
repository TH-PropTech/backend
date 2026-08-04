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
