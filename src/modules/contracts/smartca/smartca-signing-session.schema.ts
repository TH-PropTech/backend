import {
  Column,
  CreateDateColumn,
  Entity,
  ObjectId,
  ObjectIdColumn,
  UpdateDateColumn,
} from 'typeorm'

@Entity('smartca_signing_sessions')
export class SmartCaSigningSession {
  @ObjectIdColumn() _id!: ObjectId
  @Column() contractId!: string
  @Column() signerId!: string
  @Column() signerRole!: 'tenant' | 'landlord'
  @Column() artifactHash!: string
  @Column() providerTransactionId!: string
  @Column({ type: 'string', default: 'pending' })
  status!: 'pending' | 'signed' | 'rejected' | 'expired'
  @Column({ nullable: true }) confirmationUrl?: string | null
  @Column({ nullable: true }) certificateSerial?: string | null
  @Column() expiresAt!: Date
  @CreateDateColumn() createdAt!: Date
  @UpdateDateColumn() updatedAt!: Date
}
