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

/**
 * direct = khách trả thẳng vào Ví Mộc chủ nhà; relay = sàn chuyển hộ (mô phỏng);
 * external = tiền nằm ở tài khoản merchant của cổng thật, nhân viên xử lý ngoài hệ thống.
 */
export type PayoutSettlement = 'direct' | 'relay' | 'external'

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
  /** Khách đã trả thẳng vào tài khoản của chủ nhà (Ví Mộc): không có bước sàn chuyển tiền. */
  @Column({ default: false }) directReceipt!: boolean
  /** Mã giao dịch Ví Mộc khi nền tảng chuyển hộ vào Ví Mộc của chủ nhà (giả lập). */
  @Column({ type: 'string', nullable: true }) relayRef?: string | null
  /** Kênh tiền; thiếu ở dữ liệu cũ — dùng payoutSettlementOf(). */
  @Column({ type: 'string', nullable: true })
  settlement?: PayoutSettlement | null
  /** Ghi chú của nhân viên khi đánh dấu đã xử lý ngoài hệ thống. */
  @Column({ type: 'string', nullable: true }) settlementNote?: string | null
  /** Chủ nhà báo vấn đề với khoản này (một lần). */
  @Column({ nullable: true }) reportedAt?: Date | null
  @CreateDateColumn() createdAt!: Date
  @UpdateDateColumn() updatedAt!: Date
}

/** Kênh tiền của payout; dữ liệu cũ không có cột thì suy ra từ directReceipt/relayRef. */
export function payoutSettlementOf(
  payout: Pick<Payout, 'directReceipt' | 'relayRef' | 'settlement'>
): PayoutSettlement {
  if (payout.settlement) return payout.settlement
  if (payout.directReceipt) return 'direct'
  return 'relay'
}
