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
@Index(['status', 'nextRetryAt', 'leaseExpiresAt'])
@Index(['contractId', 'createdAt'])
@Index(['eventType', 'updatedAt'])
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

  @Column({ nullable: true })
  dependencyKey?: string | null

  /** PROP-399 D12/B1: nhiều parent — mọi parent phải confirmed mới nhận claim. `dependencyKey` vẫn đọc được. */
  @Column({ nullable: true })
  dependencyKeys?: string[] | null

  /** PROP-399 D6: hợp đồng liên quan (từ metadata.contractId, hoặc aggregateId của aggregate `contract`) — phục vụ lọc Audit Center. */
  @Column({ nullable: true })
  contractId?: string | null

  /** Số vòng chờ parent chưa confirmed (D12). Dùng cho backoff chờ, KHÔNG tính vào `attempts`. */
  @Column({ nullable: true, type: 'int' })
  dependencyWaitCycles?: number | null

  @Column({ nullable: true })
  claimToken?: string | null

  @Column({ nullable: true })
  claimedAt?: Date | null

  @Column({ nullable: true })
  leaseExpiresAt?: Date | null

  @Column({ nullable: true })
  confirmedAt?: Date | null

  @Column({ nullable: true })
  networkMode?: 'simulation' | 'fabric' | null

  @Column({ nullable: true, type: 'int' })
  blockNumber?: number | null

  @Column({ nullable: true })
  errorCode?: string | null

  @CreateDateColumn()
  createdAt!: Date

  @UpdateDateColumn()
  updatedAt!: Date
}
