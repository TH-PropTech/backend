import {
  Entity,
  ObjectIdColumn,
  ObjectId,
  Column,
  CreateDateColumn,
} from 'typeorm'

@Entity('blockchain_logs')
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
