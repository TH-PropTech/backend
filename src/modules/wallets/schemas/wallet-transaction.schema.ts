import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ObjectId,
  ObjectIdColumn,
} from 'typeorm'

export type WalletTransactionType =
  | 'payout-credit'
  | 'platform-fee-debit'
  | 'platform-fee-refund'

/** Sao kê ví: chỉ thêm, không sửa. (refType, refId) duy nhất để mỗi sự kiện chỉ ghi một lần. */
@Entity('wallet_transactions')
@Index(['refType', 'refId'], { unique: true })
@Index(['userId', 'createdAt'])
export class WalletTransaction {
  @ObjectIdColumn() _id!: ObjectId
  @Column() walletId!: string
  @Column() userId!: string
  @Column({ type: 'string' }) type!: WalletTransactionType
  /** Luôn dương; chiều tiền suy ra từ `type`. */
  @Column() amount!: number
  @Column() balanceAfter!: number
  @Column() refType!: string
  @Column() refId!: string
  @Column({ type: 'string', nullable: true }) contractId!: string | null
  @Column() description!: string
  @CreateDateColumn() createdAt!: Date
}
