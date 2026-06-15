import { Entity, ObjectIdColumn, ObjectId, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm'

@Entity('payments')
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

  @CreateDateColumn()
  createdAt!: Date

  @UpdateDateColumn()
  updatedAt!: Date
}
