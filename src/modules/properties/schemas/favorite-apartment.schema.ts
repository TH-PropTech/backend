import {
  Entity,
  ObjectIdColumn,
  ObjectId,
  Column,
  Index,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm'

export const USER_FAVORITES_COLLECTION = 'user_favorites'

@Entity(USER_FAVORITES_COLLECTION)
@Index('user_favorites_userId_apartmentId', ['userId', 'apartmentId'], {
  unique: true,
})
export class FavoriteApartment {
  @ObjectIdColumn()
  _id!: ObjectId

  @Column()
  userId!: string

  @Column()
  apartmentId!: string

  @CreateDateColumn()
  createdAt!: Date

  @UpdateDateColumn()
  updatedAt!: Date
}
