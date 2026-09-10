import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ObjectId,
  ObjectIdColumn,
  UpdateDateColumn,
} from 'typeorm'

export type LedgerOutboxStatus =
  | 'pending'
  | 'processing'
  | 'confirmed'
  | 'failed'

@Entity('ledger_outbox')
@Index(['aggregateType', 'aggregateId', 'eventType'], { unique: true })
export class LedgerOutbox {
  @ObjectIdColumn()
  _id!: ObjectId

  @Column()
  aggregateType!: string

  @Column()
  aggregateId!: string

  @Column()
  eventType!: string

  @Column()
  payloadHash!: string

  @Column()
  payload!: {
    action: string
    args: string[]
    metadata?: Record<string, unknown>
  }

  @Column({ type: 'string', default: 'pending' })
  status!: LedgerOutboxStatus

  @Column({ default: 0 })
  attempts!: number

  @Column({ nullable: true })
  nextRetryAt!: Date | null

  @Column({ nullable: true })
  lastError!: string | null

  @Column({ nullable: true })
  txHash!: string | null

  @CreateDateColumn()
  createdAt!: Date

  @UpdateDateColumn()
  updatedAt!: Date
}
