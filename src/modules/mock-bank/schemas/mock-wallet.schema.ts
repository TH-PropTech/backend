import {
  Column,
  CreateDateColumn,
  Entity,
  ObjectId,
  ObjectIdColumn,
  UpdateDateColumn,
} from 'typeorm'
import type { PaymentProviderName } from '../providers/payment-provider.port'

@Entity('mock_bank_wallets')
export class MockWallet {
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

  /** Số dư khả dụng (VND, số nguyên). Chỉ đổi qua WalletsService. */
  @Column({ default: 0 })
  balance!: number

  @Column({ default: 0 })
  totalReceived!: number

  @Column({ default: 0 })
  totalFeesPaid!: number

  @Column({ nullable: true })
  linkedAt!: Date | null

  @CreateDateColumn()
  createdAt!: Date

  @UpdateDateColumn()
  updatedAt!: Date
}
