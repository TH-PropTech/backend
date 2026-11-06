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
  HandoverCompletionReason,
  HandoverDiscrepancy,
  LedgerEvidenceRef,
} from './move-in-settlement.schema'

export type MoveOutHandoverStatus = 'recorded' | 'completed' | 'disputed'
export type MoveOutItemCondition = 'good' | 'damaged' | 'missing'

/** `conditionAtMoveIn` lấy từ biên bản nhận nhà đã hoàn tất; null khi đồ không có trong biên bản nhận. */
export type MoveOutInventoryItem = {
  name: string
  quantity: number
  conditionAtMoveIn: 'good' | 'damaged' | null
  noteAtMoveIn: string | null
  condition: MoveOutItemCondition
  note: string | null
}

export type MoveOutDispute = {
  by: 'tenant' | 'landlord'
  note: string
  at: Date
}

/** Ảnh chụp các bản sửa đổi cũ; chỉ thêm, phục vụ bộ chứng cứ. */
export type MoveOutRevisionSnapshot = {
  revision: number
  handoverHash: string
  recordedAt: Date
  handedBackAt: Date
  meterReadings: { electricity: number; water: number }
  meterPhotos?: { electricity: string[]; water: string[] } | null
  keyCount: number
  inventoryItems: MoveOutInventoryItem[]
  notes: string | null
}

@Entity('move_out_handovers')
@Index('move_out_handovers_contract_unique', ['contractId'], { unique: true })
export class MoveOutHandover {
  @ObjectIdColumn() _id!: ObjectId
  @Column() contractId!: string
  @Column() tenantId!: string
  @Column() landlordId!: string
  @Column() revision!: number
  @Column() handedBackAt!: Date
  @Column('json') meterReadings!: { electricity: number; water: number }
  /** Ảnh công tơ; bản ghi cũ không có. */
  @Column('json', { nullable: true }) meterPhotos?: {
    electricity: string[]
    water: string[]
  } | null
  @Column() keyCount!: number
  @Column('json') inventoryItems!: MoveOutInventoryItem[]
  @Column({ nullable: true }) notes!: string | null
  /** Phản hồi sai lệch của khách; chỉ thêm, gắn với `revision` mà nó phản hồi. */
  @Column('json') discrepancies!: HandoverDiscrepancy[]
  @Column('json') revisionHistory!: MoveOutRevisionSnapshot[]
  /** Số ngày phản hồi chốt từ gói thuê tại lúc ghi bản sửa đổi hiện hành. */
  @Column() responseDays!: number
  @Column() responseDueAt!: Date
  @Column({ type: 'string', default: 'recorded' })
  status!: MoveOutHandoverStatus
  @Column() handoverHash!: string
  @Column() recordedBy!: string
  @Column('json', { nullable: true }) tenantConfirmation!: {
    at: Date
    hash: string
  } | null
  @Column('json', { nullable: true }) landlordConfirmation!: {
    at: Date
    hash: string
  } | null
  @Column({ nullable: true }) completedAt!: Date | null
  @Column({ type: 'string', nullable: true })
  completionReason!: HandoverCompletionReason | null
  @Column('json', { nullable: true }) dispute!: MoveOutDispute | null
  @Column('json', { nullable: true }) evidence!: LedgerEvidenceRef | null
  @CreateDateColumn() createdAt!: Date
  @UpdateDateColumn() updatedAt!: Date
}
