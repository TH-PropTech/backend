import {
  Entity,
  ObjectIdColumn,
  ObjectId,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm'

@Entity('contracts')
export class Contract {
  @ObjectIdColumn()
  _id!: ObjectId

  @Column({ unique: true })
  contractCode!: string

  @Column()
  propertyId!: string

  @Column()
  propertyTitle!: string

  @Column()
  landlordId!: string

  @Column()
  tenantId!: string

  @Column()
  startDate!: Date

  @Column()
  endDate!: Date

  @Column()
  monthlyRent!: number

  @Column()
  deposit!: number

  @Column()
  paymentDay!: number

  @Column()
  latePenalty!: string

  @Column({ type: 'string', default: 'awaiting-signature' })
  status!: 'awaiting-signature' | 'active' | 'terminated'

  @Column({ default: false })
  signedByTenant!: boolean

  @Column({ default: false })
  signedByLandlord!: boolean

  @Column({ nullable: true })
  blockchainAddress!: string | null

  @CreateDateColumn()
  createdAt!: Date

  @UpdateDateColumn()
  updatedAt!: Date
}
