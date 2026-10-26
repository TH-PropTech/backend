import {
  Entity,
  Index,
  ObjectIdColumn,
  ObjectId,
  Column,
  CreateDateColumn,
} from 'typeorm'

export type PushPlatform = 'ios' | 'android'

/** Expo push token của một thiết bị đang đăng nhập; mỗi cặp (user, token) chỉ có một bản ghi. */
@Entity('push_tokens')
@Index('push_tokens_user_token', ['userId', 'token'], { unique: true })
@Index('push_tokens_token', ['token'])
export class PushToken {
  @ObjectIdColumn()
  _id!: ObjectId

  @Column()
  userId!: string

  @Column()
  token!: string

  @Column({ nullable: true })
  platform?: PushPlatform | null

  @CreateDateColumn()
  createdAt!: Date
}
