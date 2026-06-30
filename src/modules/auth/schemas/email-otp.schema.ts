import {
  Entity,
  ObjectIdColumn,
  ObjectId,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm'

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
