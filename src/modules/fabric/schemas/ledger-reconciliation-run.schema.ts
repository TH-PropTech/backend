import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ObjectId,
  ObjectIdColumn,
  UpdateDateColumn,
} from 'typeorm'

export type LedgerReconciliationRunStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'completed-with-findings'
  | 'failed'
  | 'cancelled'

export type LedgerReconciliationScope = {
  from?: Date
  to?: Date
  contractIds?: string[]
  eventTypes?: string[]
}

export type LedgerReconciliationCheckpoint = {
  eventType: string
  lastAggregateId: string
} | null

export type LedgerReconciliationCounters = {
  examined: number
  consistent: number
  findings: number
  unverifiable: number
}

/**
 * PROP-399 D7: một lần chạy đối soát bị chặn trong phạm vi, có thể tạm dừng/
 * tiếp tục qua checkpoint. Không đọc toàn bộ world state Fabric.
 */
@Entity('ledger_reconciliation_runs')
@Index(['status', 'createdAt'])
export class LedgerReconciliationRun {
  @ObjectIdColumn()
  _id!: ObjectId

  @Column()
  scopeHash!: string

  @Column('json')
  scope!: LedgerReconciliationScope

  @Column({ type: 'string', default: 'queued' })
  status!: LedgerReconciliationRunStatus

  @Column('json', { nullable: true })
  checkpoint!: LedgerReconciliationCheckpoint

  @Column('json')
  counters!: LedgerReconciliationCounters

  @Column()
  requestedBy!: string

  @Column({ nullable: true })
  startedAt!: Date | null

  @Column({ nullable: true })
  completedAt!: Date | null

  @Column({ nullable: true })
  lastErrorCode!: string | null

  @CreateDateColumn()
  createdAt!: Date

  @UpdateDateColumn()
  updatedAt!: Date
}
