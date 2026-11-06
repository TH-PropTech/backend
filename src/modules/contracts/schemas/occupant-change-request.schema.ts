import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ObjectId,
  ObjectIdColumn,
  UpdateDateColumn,
} from 'typeorm'
import type { ContractOccupant } from './contract.schema'

export type OccupantChangeRequestStatus =
  | 'pending-landlord'
  | 'pending-tenant'
  | 'agreed'
  | 'rejected'

export type OccupantRequestPerson = ContractOccupant & {
  /** Ảnh giấy tờ tùy thân; chỉ hai bên của hợp đồng và staff xem, không đưa vào hợp đồng. */
  idPhotoUrls: string[]
}

export type OccupantRequestAuditEntry = {
  at: Date
  actorId: string
  actorRole: 'tenant' | 'landlord'
  action: string
  detail: string | null
}

/**
 * Yêu cầu thêm người ở sau khi ký. Hai bên thống nhất xong thì hệ thống tạo phụ lục
 * hợp đồng; phụ lục mới là nơi ghi nhận người ở và tiền thuê mới.
 */
@Entity('occupant_change_requests')
@Index('occupant_change_requests_contract_status', ['contractId', 'status'])
export class OccupantChangeRequest {
  @ObjectIdColumn()
  _id!: ObjectId

  @Column()
  contractId!: string

  @Column()
  tenantId!: string

  @Column()
  landlordId!: string

  @Column('json')
  occupants!: OccupantRequestPerson[]

  @Column()
  moveInDate!: Date

  @Column()
  reason!: string

  /** Phụ phí hằng tháng (đồng) Khách thuê đề xuất; có thể bằng 0. */
  @Column()
  proposedSurcharge!: number

  /** Mức Chủ nhà đề xuất lại; null khi chưa đề xuất lại. */
  @Column({ nullable: true })
  counterSurcharge?: number | null

  @Column({ nullable: true })
  agreedSurcharge?: number | null

  @Column({ type: 'string', default: 'pending-landlord' })
  status!: OccupantChangeRequestStatus

  @Column({ nullable: true })
  decisionReason?: string | null

  @Column({ nullable: true })
  amendmentId?: string | null

  @Column('json')
  auditTrail!: OccupantRequestAuditEntry[]

  @CreateDateColumn()
  createdAt!: Date

  @UpdateDateColumn()
  updatedAt!: Date
}
