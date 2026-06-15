import { Entity, ObjectIdColumn, ObjectId, Column, CreateDateColumn } from 'typeorm'

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

  @Column()
  txHash!: string

  @Column()
  blockNumber!: number

  @Column()
  network!: string

  @Column()
  details!: Record<string, unknown>

  @CreateDateColumn()
  createdAt!: Date
}
