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

  @CreateDateColumn()
  createdAt!: Date

  @UpdateDateColumn()
  updatedAt!: Date
}
