import {
  Column,
  CreateDateColumn,
  Entity,
  ObjectId,
  ObjectIdColumn,
  UpdateDateColumn,
} from 'typeorm'
import type { RentalPackageSnapshot } from '../../properties/utils/rental-package.util'
import type { RentalExecutionPolicyRef } from '../../rental/utils/rental-execution-policy.util'

export type DepositAgreementStatus =
  | 'draft'
  | 'accepted'
  | 'payment-pending'
  | 'paid'
  | 'applied-to-lease-security'
  | 'released'
  | 'refunded'
  | 'cancelled'
  | 'expired'

/** Mirror of the Ví Mộc escrow status; the agreement status stays the business source of truth. */
export type DepositEscrowStatus =
  | 'AWAITING_PAYMENT'
  | 'HELD'
  | 'SETTLED'
  | 'AUTO_REFUNDED'
  | 'CANCELLED'
  | 'EXPIRED'

export type DepositEscrowSettlement = {
  /** Deterministic `deposit:<agreementId>:<kind>` so a retry never creates a second order. */
  settlementId: string
  kind: 'release' | 'refund'
  state: 'requested' | 'settled' | 'failed'
  attempts: number
  lastError?: string | null
  transactionCodes: string[]
  requestedAt: Date
  settledAt?: Date | null
}

export type DepositEscrow = {
  escrowId: string
  status: DepositEscrowStatus
  autoRefundAt: Date
  heldAt?: Date | null
  settlement?: DepositEscrowSettlement | null
}

@Entity('deposit_agreements')
export class DepositAgreement {
  @ObjectIdColumn()
  _id!: ObjectId

  @Column({ unique: true })
  agreementCode!: string

  @Column({ unique: true })
  applicationId!: string

  @Column({ nullable: true })
  propertyId?: string | null

  @Column()
  tenantId!: string

  @Column()
  landlordId!: string

  @Column()
  packageSnapshot!: RentalPackageSnapshot

  @Column({ nullable: true })
  executionPolicySnapshot?: RentalExecutionPolicyRef | null

  @Column()
  purpose!:
    | 'SECURE_CONCLUSION'
    | 'SECURE_PERFORMANCE'
    | 'SECURE_CONCLUSION_THEN_PERFORMANCE'

  @Column()
  dispositionPolicySnapshot!: Record<string, unknown>

  @Column()
  amount!: number

  @Column({ type: 'string', nullable: true, default: 'FULL_SECURITY' })
  depositKind?: 'HOLDING' | 'FULL_SECURITY'

  @Column({ nullable: true })
  securityDepositTotal?: number | null

  @Column({ nullable: true })
  securityTopUpAmount?: number | null

  @Column()
  templateVersion!: string

  @Column()
  contentRevision!: number

  @Column()
  contentHash!: string

  @Column({ type: 'string', default: 'draft' })
  status!: DepositAgreementStatus

  @Column({ nullable: true })
  tenantConsent!: { consentedAt: Date; contentHash: string } | null

  @Column({ nullable: true })
  paidAt!: Date | null

  @Column({ nullable: true })
  paymentAttemptId!: string | null

  @Column({ nullable: true })
  depositHash!: string | null

  @Column({ nullable: true })
  receiptCode?: string | null

  @Column({ nullable: true })
  receiptHash?: string | null

  @Column({ nullable: true })
  ledgerStatus?: string | null

  @Column({ nullable: true })
  depositLedgerTxId?: string | null

  @Column({ nullable: true })
  ledgerRecordedAt?: Date | null

  @Column({ nullable: true })
  manualConfirmation!: {
    confirmedBy: string
    confirmedAt: Date
    note: string
  } | null

  /** Ví Mộc escrow holding the deposit; null for legacy direct-receipt agreements. */
  @Column({ nullable: true })
  escrow?: DepositEscrow | null

  @Column({ nullable: true })
  linkedLeaseContractId!: string | null

  @Column({ nullable: true })
  linkedLeaseContractHash!: string | null

  @CreateDateColumn()
  createdAt!: Date

  @UpdateDateColumn()
  updatedAt!: Date
}
