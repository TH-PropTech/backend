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

  @Column({ nullable: true })
  fullName?: string

  @Column({ nullable: true })
  dateOfBirth?: string

  @Column({ nullable: true })
  gender?: string

  @Column({ nullable: true })
  nationality?: string

  @Column({ nullable: true })
  placeOfOrigin?: string

  @Column({ nullable: true })
  placeOfResidence?: string

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
