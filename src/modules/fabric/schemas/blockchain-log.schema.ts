import {
  Entity,
  ObjectIdColumn,
  ObjectId,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm'

@Entity('blockchain_logs')
@Index(['contractId', 'createdAt'])
@Index(['eventType', 'createdAt'])
@Index(['txHash'])
export class BlockchainLog {
  @ObjectIdColumn()
  _id!: ObjectId

  @Column()
  action!: string

  @Column({ nullable: true })
  contractId!: string | null

  @Column({ nullable: true })
  paymentId!: string | null

  @Column({ nullable: true })
  depositId?: string | null

  /** PROP-399 D6: tham chiếu tra cứu bổ sung cho Audit Center — tùy chọn, chỉ phục vụ lookup. */
  @Column({ nullable: true })
  governanceSnapshotId?: string | null

  @Column({ nullable: true })
  settlementId?: string | null

  @Column({ nullable: true, type: 'int' })
  handoverRevision?: number | null

  @Column({ nullable: true, type: 'int' })
  schemaVersion?: number | null

  @Column({ nullable: true })
  payloadHash?: string | null

  @Column({ nullable: true })
  eventType?: string

  @Column({ type: 'string', default: 'simulation' })
  networkMode?: 'simulation' | 'fabric'

  @Column({ type: 'string', default: 'pending' })
  status?: 'pending' | 'confirmed' | 'failed'

  @Column({ nullable: true })
  retryCount?: number | null

  @Column()
  txHash!: string

  @Column({ nullable: true, type: 'int' })
  blockNumber!: number | null

  @Column()
  network!: string

  @Column()
  details!: Record<string, unknown>

  @CreateDateColumn()
  createdAt!: Date
}
