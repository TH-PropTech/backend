import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ObjectId,
  ObjectIdColumn,
  UpdateDateColumn,
} from 'typeorm'
import type { LedgerEvidenceRef } from './move-in-settlement.schema'

export type DepositStatementStatus =
  | 'draft'
  | 'awaiting-tenant'
  | 'accepted'
  | 'disputed'
  | 'refund-recorded'
  | 'closed'
export type DepositStatementAcceptedReason =
  | 'tenant-accepted'
  | 'tenant-no-response'
  | 'no-deductions'
export type DepositStatementCloseReason =
  | 'tenant-acknowledged'
  | 'tenant-no-acknowledge'
  | 'no-refund-due'

export type DepositStatementLine = {
  id: string
  reason: string
  amount: number
  /** URL ảnh JPEG/PNG đã tải lên qua `POST /apartments/upload`. */
  evidenceUrls: string[]
  /** Vắng mặt = Chủ nhà tự nhập; `meter-suggestion` = gợi ý từ chỉ số công tơ. */
  source?: 'manual' | 'meter-suggestion'
  tenantResponse: {
    decision: 'accept' | 'reject'
    note: string | null
    at: Date
  } | null
}

/** Lãi chủ nhà chậm hoàn cọc: chỉ để tính và thông báo, hai bên tự thanh toán cho nhau. */
export type DepositRefundLateInterest = {
  ratePerYear: number
  daysLate: number
  amount: number
  legalBasis: string
}

/** Khai báo của chủ nhà; không có tệp đính kèm, `transactionRef` chỉ là văn bản. */
export type DepositRefundRecord = {
  id: string
  amount: number
  transactionRef: string
  paidAt: Date
  note: string | null
  recordedAt: Date
  recordedBy: string
  tenantAcknowledgedAt: Date | null
  evidence: LedgerEvidenceRef | null
  /** `null` khi hoàn đúng hạn; bản ghi tạo trước change này đọc ra `null`. */
  lateInterest: DepositRefundLateInterest | null
}

export type DepositStatementAuditEntry = {
  at: Date
  actorId: string | null
  actorRole: 'tenant' | 'landlord' | 'system'
  action: string
  detail: string | null
}

@Entity('deposit_settlement_statements')
@Index('deposit_settlement_statements_contract_unique', ['contractId'], {
  unique: true,
})
@Index('deposit_settlement_statements_status_response_due', [
  'status',
  'responseDueAt',
])
export class DepositSettlementStatement {
  @ObjectIdColumn() _id!: ObjectId
  @Column() contractId!: string
  @Column() tenantId!: string
  @Column() landlordId!: string
  /** Chốt từ `contract.deposit` tại lúc lập bảng. */
  @Column() depositAmount!: number
  @Column('json') lines!: DepositStatementLine[]
  @Column('json') refunds!: DepositRefundRecord[]
  @Column({ type: 'string', default: 'draft' }) status!: DepositStatementStatus
  @Column() responseDays!: number
  @Column({ nullable: true }) statementHash!: string | null
  @Column({ nullable: true }) submittedAt!: Date | null
  @Column({ nullable: true }) responseDueAt!: Date | null
  @Column({ nullable: true }) acceptedAt!: Date | null
  @Column({ type: 'string', nullable: true })
  acceptedReason!: DepositStatementAcceptedReason | null
  @Column({ nullable: true }) refundDueAt!: Date | null
  @Column({ nullable: true }) refundReminderSentAt!: Date | null
  @Column({ nullable: true }) refundOverdueAt!: Date | null
  @Column({ nullable: true }) closedAt!: Date | null
  @Column({ type: 'string', nullable: true })
  closeReason!: DepositStatementCloseReason | null
  @Column('json', { nullable: true }) dispute!: {
    by: 'tenant' | 'landlord'
    note: string
    at: Date
  } | null
  @Column('json') auditLog!: DepositStatementAuditEntry[]
  @Column('json', { nullable: true }) evidence!: LedgerEvidenceRef | null
  @CreateDateColumn() createdAt!: Date
  @UpdateDateColumn() updatedAt!: Date
}
