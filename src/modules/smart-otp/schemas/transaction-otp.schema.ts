import {
  Entity,
  ObjectIdColumn,
  ObjectId,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm'
import { OtpActionType } from '../enums/otp-action-type.enum'
import { OtpSessionStatus } from '../enums/otp-session-status.enum'

@Entity('transaction_otps')
export class TransactionOtp {
  @ObjectIdColumn()
  _id!: ObjectId

  @Column()
  userId!: string

  @Column()
  deviceId!: string

  @Column({
    type: 'string',
    enum: OtpActionType,
  })
  action!: OtpActionType

  @Column()
  challenge!: string // Chuỗi ngẫu nhiên gửi về mobile app để ký bằng khóa bí mật

  @Column()
  otpCode!: string // Mã OTP (thường là 6 chữ số) tương ứng sinh ra

  @Column({
    type: 'string',
    enum: OtpSessionStatus,
    default: OtpSessionStatus.INITIATED,
  })
  status!: OtpSessionStatus

  @Column({ default: 0 })
  attempts!: number

  @Column({ default: 3 })
  maxAttempts!: number

  @Column()
  expiredAt!: Date

  @CreateDateColumn()
  createdAt!: Date

  @UpdateDateColumn()
  updatedAt!: Date
}
