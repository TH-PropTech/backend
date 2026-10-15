import {
  Entity,
  ObjectIdColumn,
  ObjectId,
  Column,
  CreateDateColumn,
} from 'typeorm'

/**
 * @deprecated G-LOG: gộp vào `ActivityLog` (collection `activity_logs`, `kind: 'recommendation'`).
 * Giữ lại để đọc collection cũ và migration 023. Không đăng ký forFeature, không ghi mới.
 */
@Entity('recommendation_histories')
export class RecommendationHistory {
  @ObjectIdColumn()
  _id!: ObjectId

  @Column()
  userAge!: number

  @Column()
  userIncome!: number

  @Column()
  preferredDistrict!: string

  @Column()
  preferredBedrooms!: number

  @Column()
  requiresGym!: number // 0 | 1

  @Column()
  requiresParking!: number // 0 | 1

  @Column()
  rentedApartmentId!: string

  @Column({ default: 5.0, nullable: true })
  satisfactionScore?: number

  @CreateDateColumn()
  createdAt!: Date
}
