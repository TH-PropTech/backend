import {
  Column,
  CreateDateColumn,
  Entity,
  ObjectId,
  ObjectIdColumn,
  UpdateDateColumn,
} from 'typeorm'
import type { PaymentProviderName } from '../../mock-bank/providers/payment-provider.port'

/**
 * Ví = liên kết tài khoản ngân hàng, không lưu ký (xem openspec
 * `non-custodial-wallets`). Collection giữ nguyên `mock_bank_wallets` để
 * không cần migration; document cũ còn `balance`/`totalReceived`/
 * `totalFeesPaid` trong Mongo nhưng các trường này không còn ý nghĩa.
 */
@Entity('mock_bank_wallets')
export class Wallet {
  @ObjectIdColumn()
  _id!: ObjectId

  @Column({ unique: true })
  userId!: string

  @Column({ type: 'string', default: 'mock-bank' })
  provider!: PaymentProviderName

  @Column()
  externalAccountRef!: string

  @Column({ type: 'string', default: 'linked' })
  status!: 'linked' | 'unlinked'

  @Column({ default: true })
  simulation!: boolean

  /** Ngân hàng nhận tiền rút/đối soát; chỉ giữ 4 số cuối của tài khoản. */
  @Column({ type: 'string', nullable: true })
  bankCode!: string | null

  @Column({ type: 'string', nullable: true })
  bankName!: string | null

  @Column({ type: 'string', nullable: true })
  accountHolder!: string | null

  @Column({ type: 'string', nullable: true })
  accountNumberMasked!: string | null

  /**
   * Số tài khoản Ví Mộc đầy đủ (mã định danh sandbox, không phải số tài khoản
   * thật) dùng làm `payeeAccountNumber`; null với ngân hàng khác.
   */
  @Column({ type: 'string', nullable: true })
  mocbankAccountNumber?: string | null

  @Column({ nullable: true })
  linkedAt!: Date | null

  @CreateDateColumn()
  createdAt!: Date

  @UpdateDateColumn()
  updatedAt!: Date
}
