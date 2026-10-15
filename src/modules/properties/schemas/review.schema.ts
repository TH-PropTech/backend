import {
  Entity,
  ObjectIdColumn,
  ObjectId,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm'

export interface ReviewRatings {
  responsiveness: number // Mức độ phản hồi
  quality: number // Chất lượng căn hộ/phòng
  maintenance: number // Mức độ hỗ trợ bảo trì
  commitment: number // Mức độ thực hiện cam kết
}

/**
 * @deprecated G-REV: thay bằng `Apartment.reviews[]` (`schemas/apartment.schema.ts`, migration 030).
 * Giữ file để rollback/migration 030; không đăng ký trong `forFeature`.
 * Collection `reviews` không bị xóa.
 */
@Entity('reviews')
export class Review {
  @ObjectIdColumn()
  _id!: ObjectId

  @Column()
  authorId!: string

  @Column()
  authorName!: string

  @Column()
  targetUserId!: string

  @Column()
  contractId!: string

  @Column()
  comment!: string

  @Column({ type: 'json' })
  ratings!: ReviewRatings

  @Column()
  overall!: number

  @CreateDateColumn()
  createdAt!: Date

  @UpdateDateColumn()
  updatedAt!: Date
}
