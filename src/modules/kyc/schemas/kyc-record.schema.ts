import {
  Entity,
  ObjectIdColumn,
  ObjectId,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm'

@Entity('kyc_records')
export class KycRecord {
  @ObjectIdColumn()
  _id!: ObjectId

  @Column()
  userId!: string

  @Column()
  idCardNumber!: string

  @Column()
  frontCardUrl!: string

  @Column()
  backCardUrl!: string

  @Column()
  selfieUrl!: string

  @Column({ type: 'string', default: 'pending' })
  status!: 'pending' | 'verified' | 'rejected'

  @Column({ nullable: true })
  rejectedReason!: string | null

  @Column({ nullable: true })
  verifiedAt!: Date | null

  @CreateDateColumn()
  createdAt!: Date

  @UpdateDateColumn()
  updatedAt!: Date
}
