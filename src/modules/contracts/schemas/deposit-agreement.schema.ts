import {
  Column,
  CreateDateColumn,
  Entity,
  ObjectId,
  ObjectIdColumn,
  UpdateDateColumn,
} from 'typeorm'
import type { RentalPackageSnapshot } from '../../apartments/rental-package.util'

export type DepositAgreementStatus =
  | 'draft'
  | 'accepted'
  | 'payment-pending'
  | 'paid'
  | 'applied-to-lease-security'
  | 'cancelled'

@Entity('deposit_agreements')
export class DepositAgreement {
  @ObjectIdColumn()
  _id!: ObjectId

  @Column({ unique: true })
  agreementCode!: string

  @Column({ unique: true })
  applicationId!: string

  @Column()
  tenantId!: string

  @Column()
  landlordId!: string

  @Column()
  packageSnapshot!: RentalPackageSnapshot

  @Column()
  purpose!:
    | 'SECURE_CONCLUSION'
    | 'SECURE_PERFORMANCE'
    | 'SECURE_CONCLUSION_THEN_PERFORMANCE'

  @Column()
  dispositionPolicySnapshot!: Record<string, unknown>

  @Column()
  amount!: number

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
  manualConfirmation!: {
    confirmedBy: string
    confirmedAt: Date
    note: string
  } | null

  @Column({ nullable: true })
  linkedLeaseContractId!: string | null

  @Column({ nullable: true })
  linkedLeaseContractHash!: string | null

  @CreateDateColumn()
  createdAt!: Date

  @UpdateDateColumn()
  updatedAt!: Date
}
