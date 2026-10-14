import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ObjectId,
  ObjectIdColumn,
  UpdateDateColumn,
} from 'typeorm'

export type PropertyOwnershipTransferStatus =
  | 'previewed'
  | 'applying'
  | 'completed'
  | 'rejected'
  | 'failed'
  | 'rolled-back'

export interface OwnershipTransferCounts {
  apartments: number
  openBookings: number
  openApplications: number
  contracts: number
  depositAgreements: number
  payments: number
  disputes: number
}

export interface OwnershipTransferConflict {
  code: string
  entityType: string
  entityId: string
  message: string
}

export interface OwnershipTransferFinalReport {
  updatedApartments: number
  reassignedBookings: number
  reassignedApplications: number
  preservedContracts: number
  preservedDepositAgreements: number
  preservedPayments: number
  preservedDisputes: number
  auditRecordCount: number
}

@Entity('property_ownership_transfers')
@Index(['targetLandlordId', 'status'])
@Index(['idempotencyKey'], { unique: true, sparse: true })
export class PropertyOwnershipTransfer {
  @ObjectIdColumn()
  _id!: ObjectId

  @Column()
  targetLandlordId!: string

  @Column()
  initiatedBy!: string

  @Column({ type: 'string' })
  status!: PropertyOwnershipTransferStatus

  @Column()
  previewHash!: string

  @Column({ nullable: true })
  idempotencyKey?: string | null

  @Column('array')
  sourceOwnerIds!: string[]

  @Column({ type: 'json' })
  affectedCounts!: OwnershipTransferCounts

  @Column({ type: 'json' })
  immutableCounts!: Omit<
    OwnershipTransferCounts,
    'apartments' | 'openBookings' | 'openApplications'
  >

  @Column({ type: 'json' })
  conflicts!: OwnershipTransferConflict[]

  @Column({ type: 'json', nullable: true })
  finalReport?: OwnershipTransferFinalReport | null

  @Column()
  expiresAt!: Date

  @Column({ nullable: true })
  completedAt?: Date | null

  @CreateDateColumn()
  createdAt!: Date

  @UpdateDateColumn()
  updatedAt!: Date
}
