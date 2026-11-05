import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ObjectId,
  ObjectIdColumn,
  UpdateDateColumn,
} from 'typeorm'

export type ContractChangeRequestStatus =
  | 'pending-counterparty'
  | 'applied'
  | 'rejected'
  | 'cancelled'
  | 'expired'

export type ContractChangeRequestRole = 'tenant' | 'landlord'

export type ContractChangeRequestChange = {
  field: string
  before: unknown
  after: unknown
}

/**
 * Yêu cầu chỉnh sửa hợp đồng NHÁP (chưa khóa nội dung). Một bên đề xuất, bên còn lại
 * đồng ý thì mới ghi vào `Contract.commercialDraft`. Sau khi khóa thì dùng phụ lục.
 */
@Entity('contract_change_requests')
@Index(['contractId', 'sequence'], { unique: true })
export class ContractChangeRequest {
  @ObjectIdColumn()
  _id!: ObjectId

  @Column()
  contractId!: string

  @Column()
  sequence!: number

  @Column({ type: 'string', default: 'pending-counterparty' })
  status!: ContractChangeRequestStatus

  @Column()
  requestedBy!: string

  @Column({ type: 'string' })
  requestedRole!: ContractChangeRequestRole

  @Column('json')
  changes!: ContractChangeRequestChange[]

  @Column()
  reason!: string

  /** `commercialRevision` của hợp đồng lúc tạo yêu cầu; lệch lúc đồng ý thì bị từ chối. */
  @Column()
  baseRevision!: number

  @Column({ nullable: true })
  idempotencyKey?: string | null

  @Column({ nullable: true })
  decidedBy?: string | null

  @Column({ nullable: true })
  decidedAt?: Date | null

  @Column({ nullable: true })
  decisionReason?: string | null

  @Column()
  expiresAt!: Date

  @Column('json', { nullable: true })
  auditHashes?: { beforeHash: string; afterHash: string } | null

  @CreateDateColumn()
  createdAt!: Date

  @UpdateDateColumn()
  updatedAt!: Date
}
