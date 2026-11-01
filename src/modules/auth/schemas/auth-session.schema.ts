import {
  Entity,
  ObjectIdColumn,
  ObjectId,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm'

export const AUTH_SESSIONS_COLLECTION = 'auth_sessions'

@Entity(AUTH_SESSIONS_COLLECTION)
@Index('auth_sessions_user_id', ['userId'])
@Index('auth_sessions_refresh_token_hash', ['refreshTokenHash'])
@Index('auth_sessions_expires_at_ttl', ['expiresAt'], { expireAfterSeconds: 0 })
export class AuthSession {
  @ObjectIdColumn()
  _id!: ObjectId

  @Column()
  userId!: ObjectId

  @Column()
  refreshTokenHash!: string

  @Column()
  userAgent!: string

  @Column()
  deviceLabel!: string

  @Column()
  ip!: string

  @Column()
  lastActiveAt!: Date

  @CreateDateColumn()
  createdAt!: Date

  @Column({ type: 'date', nullable: true, default: null })
  revokedAt?: Date | null

  @Column()
  expiresAt!: Date
}
