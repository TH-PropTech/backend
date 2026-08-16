import {
  Entity,
  ObjectIdColumn,
  ObjectId,
  Column,
  CreateDateColumn,
} from 'typeorm'

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
