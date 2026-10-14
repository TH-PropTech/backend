import {
  Column,
  CreateDateColumn,
  Entity,
  ObjectId,
  ObjectIdColumn,
  UpdateDateColumn,
} from 'typeorm'
import type { RentalPackageSnapshot } from '../../properties/utils/rental-package.util'
import type { RentalExecutionPolicyRef } from '../utils/rental-execution-policy.util'
import type {
  RentalApplicationListingSnapshot,
  RentalApplicationReviewSnapshot,
} from '../utils/rental-application-review.util'

export type RentalApplicationStatus = 'pending' | 'accepted' | 'rejected'

export type ContractHandoff = {
  state: 'pending' | 'provisioning' | 'ready' | 'failed' | 'rejected'
  contractId: string | null
  href: string | null
  reasonCode: string | null
}

@Entity('rental_applications')
export class RentalApplication {
  @ObjectIdColumn() _id!: ObjectId
  @Column() tenantId!: string
  @Column() apartmentId!: string
  @Column() landlordId!: string
  @Column({ nullable: true }) originalLandlordId?: string | null
  @Column({ nullable: true }) ownershipTransferId?: string | null
  @Column({ nullable: true }) packageId?: string | null
  @Column({ nullable: true }) packageVersion?: number | null
  @Column({ nullable: true }) packageSnapshot?: RentalPackageSnapshot | null
  @Column({ nullable: true })
  executionPolicySnapshot?: RentalExecutionPolicyRef | null
  @Column({ nullable: true }) contractId?: string | null
  @Column({ nullable: true }) depositAgreementId?: string | null
  @Column({ default: 1 }) applicationRevision!: number
  @Column({ default: 0 }) pricingRevision!: number
  @Column({ nullable: true })
  listingSnapshot?: RentalApplicationListingSnapshot | null
  @Column({ nullable: true })
  reviewSnapshot?: RentalApplicationReviewSnapshot | null
  @Column({ type: 'string', default: 'not-started' })
  provisioningStatus!: 'not-started' | 'ready' | 'failed'
  @Column({ nullable: true }) provisioningErrorCode?: string | null
  @Column({ nullable: true }) decisionIdempotencyKey?: string | null
  @Column({ nullable: true }) decisionNote?: string | null
  @Column({ nullable: true }) submittedAt?: Date | null
  @Column({ nullable: true }) decidedAt?: Date | null
  @Column() occupants!: number
  @Column({ nullable: true })
  occupantsDetail?: Array<{
    fullName: string
    birthYear: number
    relationship: string
  }> | null
  @Column({ nullable: true })
  vehicles?: Array<{
    type: 'motorbike' | 'car' | 'bicycle'
    quantity: number
  }> | null
  @Column({ nullable: true })
  emergencyContact?: {
    fullName: string
    relationship: string
    phone: string
  } | null
  @Column({ nullable: true })
  selectedPaymentCycleMonths?: 1 | 3 | 6 | null
  @Column({ nullable: true })
  viewingBookingId?: string | null
  @Column('json', { nullable: true })
  feeSnapshot?: {
    scheduleId: string
    version: number
    contentHash: string
    quote: Array<{
      feeKind: 'LANDLORD_COMMISSION' | 'TENANT_SERVICE'
      payerRole: 'tenant' | 'landlord'
      amountBeforeVat: number
      vatAmount: number
      amount: number
    }>
  } | null
  @Column('json', { nullable: true })
  tenantFeeAck?: { contentHash: string; acknowledgedAt: Date } | null
  @Column('json', { nullable: true })
  landlordFeeAck?: { contentHash: string; acknowledgedAt: Date } | null
  @Column() moveInDate!: Date
  @Column() leaseDurationMonths!: number
  @Column() occupation!: string
  @Column() hasPets!: boolean
  @Column({ nullable: true }) notes!: string | null
  @Column({ default: 'pending' }) status!: RentalApplicationStatus
  @Column({ nullable: true }) reasonCode!: string | null
  @Column({ nullable: true }) actorId!: string | null
  @Column({ nullable: true }) actorTimestamp!: Date | null
  @CreateDateColumn() createdAt!: Date
  @UpdateDateColumn() updatedAt!: Date

  /** Response-only projection; never persisted as application input. */
  contractHandoff?: ContractHandoff
}
