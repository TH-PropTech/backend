import {
  Entity,
  ObjectIdColumn,
  ObjectId,
  Column,
  Index,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm'

export type BiometricEvidenceStatus =
  | 'verified'
  | 'consumed'
  | 'expired'
  | 'revoked'

@Entity('biometric_evidences')
@Index(['tokenHash'], { unique: true })
@Index(['contractId', 'userId', 'status'])
export class BiometricEvidence {
  @ObjectIdColumn()
  _id!: ObjectId

  /** SHA-256 hash của opaque token được trả về cho client */
  @Column({ unique: true })
  tokenHash!: string

  @Column()
  userId!: string

  @Column()
  role!: 'tenant' | 'landlord'

  @Column()
  contractId!: string

  @Column()
  contentLockedHash!: string

  @Column({ type: 'string', default: 'verified' })
  status!: BiometricEvidenceStatus

  @Column()
  expiresAt!: Date

  @Column({ nullable: true })
  consumedAt?: Date | null

  @CreateDateColumn()
  createdAt!: Date

  @UpdateDateColumn()
  updatedAt!: Date
}
