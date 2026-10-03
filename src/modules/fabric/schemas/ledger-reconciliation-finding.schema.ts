import { Column, Entity, Index, ObjectId, ObjectIdColumn } from 'typeorm'

export type LedgerReconciliationFindingCategory =
  | 'missing_delivery_work'
  | 'retryable_delivery_failure'
  | 'terminal_delivery_failure'
  | 'missing_local_projection'
  | 'missing_ledger_evidence'
  | 'hash_schema_mismatch'
  | 'orphan_local_projection'
  | 'orphan_ledger_evidence'
  | 'unverifiable'

export type LedgerReconciliationFindingStatus =
  | 'open'
  | 'repair-pending'
  | 'resolved'
  | 'accepted-risk'

export type LedgerReconciliationFindingResolution = {
  actorId: string
  reason: string
  resolvedAt: Date
} | null

export type LedgerReconciliationFindingRepair = {
  actorId: string
  reason: string
  requestedAt: Date
} | null

/**
 * PROP-399 D7: một bất thường được phát hiện trong một lần đối soát, khử
 * trùng theo `fingerprint`. Không mutate trực tiếp ledger hay outbox — sửa
 * chỉ qua `LedgerOutboxService.enqueue`/`retryTerminal`.
 */
@Entity('ledger_reconciliation_findings')
@Index(['fingerprint'], { unique: true })
@Index(['runId', 'category', 'status'])
@Index(['aggregateType', 'aggregateId', 'eventType'])
@Index(['contractId', 'lastSeenAt'])
export class LedgerReconciliationFinding {
  @ObjectIdColumn()
  _id!: ObjectId

  @Column()
  runId!: string

  @Column()
  fingerprint!: string

  @Column({ nullable: true })
  contractId!: string | null

  @Column()
  aggregateType!: string

  @Column()
  aggregateId!: string

  @Column()
  eventType!: string

  @Column({ type: 'string' })
  category!: LedgerReconciliationFindingCategory

  @Column({ nullable: true })
  expectedHash!: string | null

  @Column({ nullable: true })
  observedHash!: string | null

  @Column({ type: 'string', default: 'open' })
  status!: LedgerReconciliationFindingStatus

  @Column({ nullable: true })
  recoveryOutboxId!: string | null

  @Column('json', { nullable: true })
  resolution!: LedgerReconciliationFindingResolution

  /** Yêu cầu sửa gần nhất (ai, lý do) — outbox liên kết nằm ở `recoveryOutboxId`. */
  @Column('json', { nullable: true })
  repair?: LedgerReconciliationFindingRepair

  @Column()
  firstSeenAt!: Date

  @Column()
  lastSeenAt!: Date
}
