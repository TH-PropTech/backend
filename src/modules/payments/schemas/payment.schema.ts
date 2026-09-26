import {
  Entity,
  ObjectIdColumn,
  ObjectId,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm'

export type PaymentType = 'deposit' | 'rent' | 'penalty'
export type PaymentLedgerStatus =
  | 'not-required'
  | 'pending'
  | 'confirmed'
  | 'failed'

@Entity('payments')
@Index(['contractId', 'type', 'periodKey'], { unique: true })
export class Payment {
  @ObjectIdColumn()
  _id!: ObjectId

  @Column()
  contractId!: string

  @Column()
  tenantId!: string

  @Column()
  landlordId!: string

  @Column()
  amount!: number

  @Column()
  description!: string

  @Column()
  dueDate!: Date

  @Column({ nullable: true })
  paidAt!: Date | null

  @Column({ type: 'string', default: 'unpaid' })
  status!: 'unpaid' | 'paid' | 'overdue'

  @Column({ nullable: true })
  txHash!: string | null

  @Column({ type: 'string', default: 'rent' })
  type?: PaymentType

  @Column({ nullable: true })
  month?: number | null

  @Column({ nullable: true })
  year?: number | null

  @Column({ nullable: true })
  paymentHash?: string | null

  @Column({ nullable: true })
  txRef?: string | null

  @Column({ nullable: true })
  confirmedBy?: string | null

  @Column({ nullable: true })
  note?: string | null

  @Column({ type: 'string', default: 'not-required' })
  ledgerStatus?: PaymentLedgerStatus

  @Column({ nullable: true })
  ledgerNetworkMode?: 'simulation' | 'fabric' | null

  @Column({ nullable: true })
  ledgerRecordedAt?: Date | null

  @Column({ nullable: true })
  periodKey?: string | null

  @Column({ nullable: true })
  reminderSentForDate?: string | null

  @Column({ nullable: true })
  reminderSentAt?: Date | null

  @Column({ nullable: true })
  governingAmendmentId?: string | null

  @Column({ nullable: true })
  governingAmendmentHash?: string | null

  @CreateDateColumn()
  createdAt!: Date

  @UpdateDateColumn()
  updatedAt!: Date
}
