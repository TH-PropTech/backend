import {
  Entity,
  ObjectIdColumn,
  ObjectId,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm'
import type { LedgerEvidenceRef } from '../../rental/schemas/move-in-settlement.schema'

export type PaymentType =
  | 'deposit'
  | 'rent'
  | 'penalty'
  | 'deposit-topup'
  | 'platform-fee'
export type PaymentLedgerStatus =
  | 'not-required'
  | 'pending'
  | 'confirmed'
  | 'failed'

@Entity('payments')
@Index(['contractId', 'type', 'periodKey'], { unique: true })
export class Payment {
  @ObjectIdColumn()
  _id!: ObjectId

  @Column()
  contractId!: string

  @Column()
  tenantId!: string

  @Column()
  landlordId!: string

  @Column()
  amount!: number

  @Column()
  description!: string

  @Column()
  dueDate!: Date

  @Column({ nullable: true })
  paidAt!: Date | null

  @Column({ type: 'string', default: 'unpaid' })
  status!: 'unpaid' | 'paid' | 'overdue' | 'waived'

  @Column({ nullable: true })
  txHash!: string | null

  @Column({ type: 'string', default: 'rent' })
  type?: PaymentType

  @Column({ nullable: true })
  month?: number | null

  @Column({ nullable: true })
  year?: number | null

  @Column({ nullable: true })
  paymentHash?: string | null

  @Column({ nullable: true })
  txRef?: string | null

  @Column({ nullable: true })
  confirmedBy?: string | null

  @Column({ nullable: true })
  note?: string | null

  @Column({ type: 'string', default: 'not-required' })
  ledgerStatus?: PaymentLedgerStatus

  @Column({ nullable: true })
  ledgerNetworkMode?: 'simulation' | 'fabric' | null

  @Column({ nullable: true })
  ledgerRecordedAt?: Date | null

  @Column({ nullable: true })
  periodKey?: string | null

  @Column({ nullable: true })
  cycleMonths?: 1 | 3 | 6 | null

  @Column({ nullable: true })
  periodStart?: Date | null

  @Column({ nullable: true })
  periodEnd?: Date | null

  @Column({ nullable: true }) payerId?: string | null
  @Column({ type: 'string', nullable: true }) payerRole?:
    | 'tenant'
    | 'landlord'
    | null
  @Column({ type: 'string', nullable: true }) payeeRole?:
    | 'landlord'
    | 'platform'
    | null
  @Column({ type: 'string', nullable: true }) feeKind?:
    | 'LANDLORD_COMMISSION'
    | 'TENANT_SERVICE'
    | null
  @Column({ nullable: true }) amountBeforeVat?: number | null
  @Column({ nullable: true }) vatAmount?: number | null
  @Column({ nullable: true }) waivedBy?: string | null
  @Column({ nullable: true }) waivedAt?: Date | null
  @Column({ nullable: true }) waiveReason?: string | null

  /** Hóa đơn `penalty`: id hóa đơn `rent` trả trễ đã sinh ra khoản này. */
  @Column({ nullable: true })
  sourcePaymentId?: string | null

  /** Hóa đơn `penalty`: dữ liệu chốt lãi chậm trả; ngày theo lịch Asia/Ho_Chi_Minh. */
  @Column({ nullable: true })
  latePenalty?: {
    baseAmount: number
    ratePerYear: number
    daysLate: number
    dueDateKey: string
    paidDateKey: string
  } | null

  /** Hóa đơn `penalty`: trạng thái bằng chứng `recordPenalty` trên sổ cái. */
  @Column({ nullable: true })
  assessmentEvidence?: LedgerEvidenceRef | null

  /** Hóa đơn `rent`: thời điểm gửi thông báo quá hạn D+1 (idempotent). */
  @Column({ nullable: true })
  overdueNoticeSentAt?: Date | null

  /** Hóa đơn `rent`: thời điểm gửi thông báo đủ điều kiện đơn phương chấm dứt (trễ quá 15 ngày). */
  @Column({ nullable: true })
  terminationRightNotifiedAt?: Date | null

  @Column({ nullable: true })
  reminderSentForDate?: string | null

  @Column({ nullable: true })
  reminderSentAt?: Date | null

  @Column({ nullable: true })
  governingAmendmentId?: string | null

  @Column({ nullable: true })
  governingAmendmentHash?: string | null

  @Column({ nullable: true })
  settlementId?: string | null

  @Column({ nullable: true })
  invoiceCode?: string | null

  @Column({ nullable: true })
  receiptCode?: string | null

  @Column({ nullable: true })
  receiptHash?: string | null

  @CreateDateColumn()
  createdAt!: Date

  @UpdateDateColumn()
  updatedAt!: Date
}
