import {
  Column,
  CreateDateColumn,
  Entity,
  ObjectId,
  ObjectIdColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm'

@Entity('smartca_signing_sessions')
@Index(['providerTransactionId'], { unique: true })
@Index(['idempotencyKey'], { unique: true, sparse: true })
@Index(['contractId', 'signerId', 'artifactHash', 'status'])
export class SmartCaSigningSession {
  @ObjectIdColumn() _id!: ObjectId
  @Column() contractId!: string
  @Column() signerId!: string
  @Column() signerRole!: 'tenant' | 'landlord'
  @Column() artifactHash!: string
  @Column() providerTransactionId!: string
  @Column({ type: 'string', default: 'pending' })
  status!: 'pending' | 'signed' | 'rejected' | 'expired' | 'cancelled'
  @Column({ nullable: true }) idempotencyKey?: string | null
  @Column({ nullable: true }) confirmationUrl?: string | null
  @Column({ nullable: true }) certificateSerial?: string | null
  @Column({ nullable: true }) certificateSubject?: string | null
  @Column({ nullable: true }) certificateIssuer?: string | null
  @Column({ nullable: true }) signatureHash?: string | null
  @Column({ nullable: true }) signatureAlgorithm?: string | null
  @Column({ nullable: true }) signatureValueRef?: string | null
  @Column({ nullable: true }) signedAt?: Date | null
  @Column({ nullable: true }) verifiedAt?: Date | null
  @Column({ nullable: true }) providerStatus?: string | null
  @Column({ nullable: true }) documentId?: string | null
  @Column() expiresAt!: Date
  @CreateDateColumn() createdAt!: Date
  @UpdateDateColumn() updatedAt!: Date
}
