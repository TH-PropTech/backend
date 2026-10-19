import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ObjectId,
  ObjectIdColumn,
  UpdateDateColumn,
} from 'typeorm'
import type {
  MomoPaymentMethod,
  PaymentProviderName,
} from '../../mock-bank/providers/payment-provider.port'

export type PaymentAttemptStatus =
  | 'pending'
  | 'processing'
  | 'succeeded'
  | 'failed'
  | 'expired'

export type PaymentClientChannel = 'web' | 'mobile'

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

  @Column('json', { nullable: true })
  paymentIds?: string[] | null

  @Column({ nullable: true })
  contractId!: string | null

  @Column({ type: 'string' })
  paymentType!: 'deposit' | 'rent' | 'settlement' | 'invoice'

  @Column()
  userId!: string

  @Column()
  amount!: number

  @Column({ type: 'string', default: 'pending' })
  /** `processing` is a transient settlement lock (see MockBankService). */
  status!: PaymentAttemptStatus

  @Column()
  expiresAt!: Date

  @Column({ nullable: true })
  processedAt!: Date | null

  @Column({ nullable: true })
  callbackDigest!: string | null

  @Column({ nullable: true })
  providerPaymentUrl!: string | null

  /** Gateway-side id: vnp_TransactionNo | MoMo transId | zp_trans_id. */
  @Column({ nullable: true })
  providerTransactionId?: string | null

  @Column({ type: 'string', nullable: true })
  clientChannel?: PaymentClientChannel | null

  /** Ví Mộc account that receives the money directly (landlord); null when it goes to the platform. */
  @Column({ type: 'string', nullable: true })
  payeeAccountNumber?: string | null

  /** MoMo request type the tenant chose; null for other providers. */
  @Column({ type: 'string', nullable: true })
  momoMethod?: MomoPaymentMethod | null

  @CreateDateColumn()
  createdAt!: Date

  @UpdateDateColumn()
  updatedAt!: Date
}
