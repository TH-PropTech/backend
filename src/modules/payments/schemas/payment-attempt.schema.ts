import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ObjectId,
  ObjectIdColumn,
  UpdateDateColumn,
} from 'typeorm'
import type { PaymentProviderName } from '../../mock-bank/providers/payment-provider.port'

@Entity('payment_attempts')
@Index(['provider', 'txRef'], { unique: true })
export class PaymentAttempt {
  @ObjectIdColumn()
  _id!: ObjectId

  @Column()
  provider!: PaymentProviderName

  @Column({ unique: true })
  txRef!: string

  @Column()
  paymentId!: string

  @Column({ type: 'string' })
  paymentType!: 'deposit' | 'rent'

  @Column()
  userId!: string

  @Column()
  amount!: number

  @Column({ type: 'string', default: 'pending' })
  status!: 'pending' | 'succeeded' | 'failed' | 'expired'

  @Column()
  expiresAt!: Date

  @Column({ nullable: true })
  processedAt!: Date | null

  @Column({ nullable: true })
  callbackDigest!: string | null

  @CreateDateColumn()
  createdAt!: Date

  @UpdateDateColumn()
  updatedAt!: Date
}
