import {
  Column,
  CreateDateColumn,
  Entity,
  ObjectId,
  ObjectIdColumn,
  UpdateDateColumn,
} from 'typeorm'

export type ListingReviewType =
  | 'stale'
  | 'duplicate_photo'
  | 'duplicate_location'
  | 'duplicate_phone'
  | 'similar_content'

export type ListingReviewStatus = 'pending' | 'confirmed' | 'dismissed'

/**
 * @deprecated G-RVC: dữ liệu nay nằm ở `ReviewCase{kind:'listing'}` (collection
 * `review_cases`). Giữ lại làm kiểu hình trả về và để migration 015 / rollback
 * tham chiếu collection cũ `listing_review_cases`; entity này KHÔNG còn nằm trong
 * `TypeOrmModule.forFeature`.
 */
@Entity('listing_review_cases')
export class ListingReviewCase {
  @ObjectIdColumn()
  _id!: ObjectId

  @Column()
  apartmentId!: string

  @Column()
  type!: ListingReviewType

  @Column()
  confidence!: number

  @Column({ nullable: true })
  relatedApartmentId!: string | null

  @Column({ default: 'pending' })
  status!: ListingReviewStatus

  @Column()
  evidence!: string

  @Column({ nullable: true })
  reviewedBy!: string | null

  @Column({ nullable: true })
  reviewedAt!: Date | null

  @CreateDateColumn()
  createdAt!: Date

  @UpdateDateColumn()
  updatedAt!: Date
}
