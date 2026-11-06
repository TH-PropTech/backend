import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ObjectId,
  ObjectIdColumn,
  UpdateDateColumn,
} from 'typeorm'

export type SettlementStatus =
  | 'pending'
  | 'partially-paid'
  | 'paid'
  | 'overdue'
  | 'cancelled'
export type SettlementLine = {
  kind: 'DEPOSIT_TOPUP' | 'FIRST_RENT' | 'TENANT_SERVICE_FEE'
  amount: number
  paymentId: string | null
  paidAt?: Date | null
}

export type HandoverInventoryItem = {
  name: string
  quantity: number
  condition: 'good' | 'damaged'
  note: string | null
}
/** Mục kiểm tra của mẫu bàn giao tại thời điểm lập biên bản (nhãn được chụp lại, không đổi theo mẫu về sau). */
export type HandoverChecklistEntry = {
  id: string
  label: string
  checked: boolean
}
/** Phiên bản mẫu bàn giao đã dùng để lập biên bản. */
export type HandoverTemplateRef = { version: number; contentHash: string }
/** Phản hồi sai lệch của khách thuê, gắn với bản sửa đổi mà nó phản hồi; chỉ thêm, không ghi đè. */
export type HandoverDiscrepancy = { revision: number; note: string; at: Date }
export type HandoverCompletionReason = 'both-confirmed' | 'tenant-no-response'

/** PROP-399 D3: tham chiếu bằng chứng ledger cho một manifest (quyết toán hoặc bàn giao). */
export type LedgerEvidenceRef = {
  manifestVersion: number
  manifestHash: string
  ledgerStatus:
    | 'pending'
    | 'confirmed-fabric'
    | 'confirmed-simulation'
    | 'failed-terminal'
  txHash: string | null
  blockNumber: number | null
  recordedAt: Date
}

@Entity('move_in_settlements')
@Index(['contractId'], { unique: true })
export class MoveInSettlement {
  @ObjectIdColumn() _id!: ObjectId
  @Column() contractId!: string
  @Column() tenantId!: string
  @Column() landlordId!: string
  @Column('json') lines!: SettlementLine[]
  @Column() total!: number
  @Column() dueAt!: Date
  @Column({ type: 'string', default: 'pending' }) status!: SettlementStatus
  @Column() statementHash!: string
  @Column({ nullable: true }) overdueNotifiedAt?: Date | null
  @Column('json', { nullable: true }) handover?: {
    revision: number
    handedOverAt: Date
    meterReadings: { electricity: number; water: number }
    /** Ảnh công tơ; bản ghi cũ không có. */
    meterPhotos?: { electricity: string[]; water: string[] } | null
    keyCount: number
    inventoryReference: string | null
    /** Các trường dưới đây tùy chọn để bản ghi cũ (trước phương án A) vẫn đọc được. */
    inventoryItems?: HandoverInventoryItem[]
    checklist?: HandoverChecklistEntry[]
    templateRef?: HandoverTemplateRef | null
    discrepancies?: HandoverDiscrepancy[]
    responseDueAt?: Date | null
    completionReason?: HandoverCompletionReason | null
    notes: string | null
    handoverHash: string
    recordedBy: string
    tenantConfirmation: { at: Date; hash: string } | null
    landlordConfirmation: { at: Date; hash: string } | null
    discrepancyNote: string | null
    overrideReason?: string | null
    completedAt: Date | null
  } | null
  /** PROP-399 D3: bằng chứng MOVE_IN_SETTLED/HANDOVER_RECORDED đã neo (hoặc chờ neo) trên ledger. */
  @Column('json', { nullable: true })
  settlementEvidence?: LedgerEvidenceRef | null
  @Column('json', { nullable: true })
  handoverEvidence?: LedgerEvidenceRef | null
  @CreateDateColumn() createdAt!: Date
  @UpdateDateColumn() updatedAt!: Date
}
