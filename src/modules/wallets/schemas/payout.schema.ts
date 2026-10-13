import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ObjectId,
  ObjectIdColumn,
  UpdateDateColumn,
} from 'typeorm'

export type PayoutStatus = 'awaiting-wallet' | 'pending' | 'paid-out' | 'failed'

@Entity('payouts')
@Index(['paymentId'], { unique: true })
@Index(['txRef'], { unique: true, sparse: true })
@Index(['landlordId', 'createdAt'])
export class Payout {
  @ObjectIdColumn() _id!: ObjectId
  @Column() paymentId!: string
  @Column({ nullable: true }) contractId!: string | null
  @Column() landlordId!: string
  @Column({ nullable: true }) walletId!: string | null
  @Column({ nullable: true }) txRef!: string | null
  /** Số tiền sàn chuyển đi (bằng Payment.amount). */
  @Column() sentAmount!: number
  /** Luôn 0: hoa hồng sàn thu bằng hóa đơn riêng, chủ nhà trả từ số dư ví. */
  @Column({ default: 0 }) feeAmount!: number
  /** Số tiền chủ nhà nhận = sentAmount - feeAmount. */
  @Column() receivedAmount!: number
  @Column({ type: 'string', default: 'awaiting-wallet' }) status!: PayoutStatus
  @Column({ default: 1 }) attempts!: number
  @Column({ nullable: true }) failureReason!: string | null
  @Column({ nullable: true }) paidOutAt!: Date | null
  @CreateDateColumn() createdAt!: Date
  @UpdateDateColumn() updatedAt!: Date
}
