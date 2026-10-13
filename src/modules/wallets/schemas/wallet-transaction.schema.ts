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

/**
 * @deprecated (non-custodial-wallets, D6) Sổ cái ví cũ — KHÔNG đọc entity này
 * cho sao kê mới. `WalletsService.listTransactions` nay dựng sao kê từ
 * `Payout` (paid-out) + `Payment` (platform-fee đã trả), xem design.md D5.
 * Nhóm 4 (task 4.2) đã xóa `debitInvoice`/`refundInvoice`/`applyEntry`/
 * `findEntry` khỏi `wallets.service.ts` (chuỗi gọi duy nhất của entity này,
 * qua `mock-bank.service.ts#payInvoiceFromWallet` — route đã gỡ) và đã bỏ
 * `WalletTransaction` khỏi `TypeOrmModule.forFeature` của `WalletsModule`;
 * không còn repository nào inject entity này. Dữ liệu cũ trong collection
 * `wallet_transactions` được giữ nguyên trong Mongo để đối soát thủ công
 * ngoài ứng dụng (không xóa dữ liệu), xem D6.
 */
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
