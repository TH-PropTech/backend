import {
  Entity,
  ObjectIdColumn,
  ObjectId,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm'

@Entity('email_otps')
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
