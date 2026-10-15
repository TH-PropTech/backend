import {
  Entity,
  ObjectIdColumn,
  ObjectId,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm'

/**
 * @deprecated G-OTP: thay bằng `Otp` (kind 'email', collection `otps`, xem
 * `otp.schema.ts`). Giữ file để migration 021 đọc `email_otps`; không còn
 * đăng ký trong `TypeOrmModule.forFeature`.
 */
@Entity('email_otps')
@Index(['email', 'otpCode', 'action', 'isUsed'])
export class EmailOtp {
  @ObjectIdColumn()
  _id!: ObjectId

  @Column()
  email!: string

  @Column()
  otpCode!: string

  @Column()
  action!: 'login' | 'forgot-password' | 'signup'

  @Column({ default: false })
  isUsed!: boolean

  @Column()
  expiredAt!: Date

  @CreateDateColumn()
  createdAt!: Date

  @UpdateDateColumn()
  updatedAt!: Date
}
