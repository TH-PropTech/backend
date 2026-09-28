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
    keyCount: number
    inventoryReference: string | null
    notes: string | null
    handoverHash: string
    recordedBy: string
    tenantConfirmation: { at: Date; hash: string } | null
    landlordConfirmation: { at: Date; hash: string } | null
    discrepancyNote: string | null
    overrideReason?: string | null
    completedAt: Date | null
  } | null
  @CreateDateColumn() createdAt!: Date
  @UpdateDateColumn() updatedAt!: Date
}
