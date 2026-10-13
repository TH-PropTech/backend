import {
  Entity,
  ObjectIdColumn,
  ObjectId,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm'

@Entity('disputes')
export class Dispute {
  @ObjectIdColumn()
  _id!: ObjectId

  @Column()
  contractId!: string

  @Column()
  tenantId!: string

  @Column()
  tenantClaim!: string

  @Column()
  landlordId!: string

  @Column()
  landlordClaim!: string

  @Column()
  depositAmount!: number

  @Column()
  depositEth!: number

  @Column({ default: 'pending' })
  status!: 'pending' | 'resolved'

  @Column({ nullable: true })
  resolution?: string

  @Column({ nullable: true })
  txHash?: string

  @CreateDateColumn()
  createdAt!: Date

  @UpdateDateColumn()
  updatedAt!: Date
}
