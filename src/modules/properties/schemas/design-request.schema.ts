import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ObjectId,
  ObjectIdColumn,
  UpdateDateColumn,
} from 'typeorm'

export const DESIGN_REQUEST_STATUSES = [
  'submitted',
  'needs_info',
  'rejected',
  'escalated',
  'in_progress',
  'delivered',
  'changes_requested',
  'approved',
  'cancelled',
] as const
export type DesignRequestStatus = (typeof DESIGN_REQUEST_STATUSES)[number]

export const TERMINAL_DESIGN_REQUEST_STATUSES: readonly DesignRequestStatus[] =
  ['rejected', 'approved', 'cancelled']

export const ACTIVE_DESIGN_REQUEST_STATUSES: readonly DesignRequestStatus[] =
  DESIGN_REQUEST_STATUSES.filter(
    s => !TERMINAL_DESIGN_REQUEST_STATUSES.includes(s)
  )

export const DESIGN_REQUEST_KINDS = ['create', 'edit'] as const
export type DesignRequestKind = (typeof DESIGN_REQUEST_KINDS)[number]

export const DESIGN_REQUEST_EVENT_TYPES = [
  'submitted',
  'info_requested',
  'info_provided',
  'escalated',
  'rejected',
  'started',
  'delivered',
  'feedback',
  'approved',
  'cancelled',
] as const
export type DesignRequestEventType = (typeof DESIGN_REQUEST_EVENT_TYPES)[number]

export type DesignRequestActorRole = 'landlord' | 'staff' | 'admin'

/** Số sự kiện tối đa giữ lại trên một yêu cầu (cũ nhất bị cắt). */
export const MAX_DESIGN_REQUEST_EVENTS = 500
export const MAX_DESIGN_REQUEST_ATTACHMENTS = 10

export interface DesignRequestEvent {
  type: DesignRequestEventType
  actorId: string
  actorRole: DesignRequestActorRole
  note: string | null
  attachmentUrls: string[]
  revision: number
  at: Date
}

/**
 * Yêu cầu thiết kế / chỉnh sửa 3D của chủ nhà. `events[]` nhúng, chỉ ghi bằng `updateOne`
 * nguyên tử ($push có trần) kèm điều kiện trạng thái — không đọc-rồi-ghi mảng.
 */
@Entity('apartment_design_requests')
@Index(['landlordId', 'createdAt'])
@Index(['status', 'updatedAt'])
@Index(['apartmentId', 'status'])
export class DesignRequest {
  @ObjectIdColumn() _id!: ObjectId
  @Column() apartmentId!: string
  /** Bản sao `Apartment.landlordId` lúc tạo. */
  @Column() landlordId!: string
  @Column({ type: 'string' }) kind!: DesignRequestKind
  @Column({ type: 'string', nullable: true }) targetDesignId!: string | null
  @Column() brief!: string
  @Column({ type: 'array' }) attachmentUrls!: string[]
  @Column({ type: 'string' }) status!: DesignRequestStatus
  @Column({ default: 0 }) revision!: number
  @Column({ type: 'string', nullable: true }) deliveredDesignId!: string | null
  @Column({ type: 'string', nullable: true }) assignedAdminId!: string | null
  @Column({ type: 'array' }) events!: DesignRequestEvent[]
  @CreateDateColumn() createdAt!: Date
  @UpdateDateColumn() updatedAt!: Date
}
