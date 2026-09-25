import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ObjectId,
  ObjectIdColumn,
  UpdateDateColumn,
} from 'typeorm'
import type {
  ContractCommercialDraft,
  ContractSignature,
} from './contract.schema'

export type ContractAmendmentStatus =
  | 'draft'
  | 'in-review'
  | 'locked'
  | 'pending-signature'
  | 'effective'
  | 'rejected'
  | 'cancelled'
  | 'superseded'

export type ContractAmendmentChange = {
  field: keyof ContractCommercialDraft
  before: unknown
  after: unknown
}

@Entity('contract_amendments')
@Index(['contractId', 'sequence'], { unique: true })
@Index(['contractId', 'status', 'effectiveFrom'])
@Index(['contractId', 'idempotencyKey'], { unique: true, sparse: true })
export class ContractAmendment {
  @ObjectIdColumn()
  _id!: ObjectId

  @Column()
  contractId!: string

  @Column()
  sequence!: number

  @Column({ type: 'string', default: 'draft' })
  status!: ContractAmendmentStatus

  @Column()
  revision!: number

  @Column('json')
  changes!: ContractAmendmentChange[]

  @Column('json')
  beforeSnapshot!: ContractCommercialDraft

  @Column('json')
  afterSnapshot!: ContractCommercialDraft

  @Column()
  effectiveFrom!: Date

  @Column({ nullable: true })
  predecessorId?: string | null

  @Column({ nullable: true })
  contentHash?: string | null

  @Column({ nullable: true })
  artifactHash?: string | null

  @Column({ nullable: true })
  artifactId?: string | null

  @Column('json', { nullable: true })
  artifactRef?: {
    artifactId: string
    revision: number
    artifactHash: string
    canonicalContentHash: string
    rendererVersion: string
    sourceSchemaVersion: number
    byteLength: number
    contentType: 'application/pdf'
    lockedAt: Date
  } | null

  @Column({ nullable: true })
  idempotencyKey?: string | null

  @Column({ nullable: true })
  lockedAt?: Date | null

  @Column({ nullable: true })
  projectionAppliedAt?: Date | null

  @Column({ nullable: true })
  rejectedAt?: Date | null

  @Column({ nullable: true })
  cancelledAt?: Date | null

  @Column({ nullable: true })
  tenantSignature?: ContractSignature | null

  @Column({ nullable: true })
  landlordSignature?: ContractSignature | null

  @Column({ nullable: true })
  ledgerStatus?: 'not-requested' | 'pending' | 'confirmed' | 'failed'

  @Column({ nullable: true })
  ledgerTxHash?: string | null

  @Column({ nullable: true })
  createdBy!: string

  @CreateDateColumn()
  createdAt!: Date

  @UpdateDateColumn()
  updatedAt!: Date
}
