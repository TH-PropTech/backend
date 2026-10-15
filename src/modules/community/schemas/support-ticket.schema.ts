import {
  Entity,
  ObjectIdColumn,
  ObjectId,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm'

export type TicketCategory =
  | 'account'
  | 'listing'
  | 'booking'
  | 'payment'
  | 'kyc'
  | 'technical'
  | 'feedback'

export type TicketPriority = 'low' | 'normal' | 'high' | 'urgent'

export type TicketStatus =
  | 'open'
  | 'in_progress'
  | 'waiting_customer'
  | 'waiting_staff'
  | 'escalated'
  | 'resolved'
  | 'closed'

export interface TransferHistoryItem {
  fromStaffId: string
  toStaffId: string
  transferredAt: Date
  reason: string
}

/** Tin nhắn nhúng trong ticket (thay cho collection `ticket_messages`). */
export interface TicketMessageEntry {
  _id: ObjectId
  senderId: string
  senderRole: string
  content: string
  attachmentUrls: string[]
  isInternal: boolean
  createdAt: Date
}

/** Số tin nhắn tối đa trong một ticket (409 khi vượt). */
export const MAX_TICKET_MESSAGES = 500

@Entity('support_tickets')
export class SupportTicket {
  @ObjectIdColumn()
  _id!: ObjectId

  @Column()
  requesterId!: string

  @Column()
  requesterRole!: string

  @Column()
  category!: TicketCategory

  @Column()
  subject!: string

  @Column()
  description!: string

  @Column({ nullable: true })
  linkedEntityType?: 'apartment' | 'booking' | 'contract' | 'payment'

  @Column({ nullable: true })
  linkedEntityId?: string

  @Column({ default: 'normal' })
  priority!: TicketPriority

  @Column({ default: 'open' })
  status!: TicketStatus

  @Column({ nullable: true })
  assignedTo?: string

  @Column({ nullable: true })
  assignedAt?: Date

  @Column()
  slaDeadline!: Date

  @Column({ nullable: true })
  firstResponseAt?: Date

  @Column({ nullable: true })
  resolvedAt?: Date

  @Column({ nullable: true })
  closedAt?: Date

  @Column({ nullable: true })
  resolutionNote?: string

  @Column({ nullable: true })
  escalatedTo?: string

  @Column({ nullable: true })
  escalatedAt?: Date

  @Column({ nullable: true })
  escalationReason?: string

  @Column('array')
  transferHistory!: TransferHistoryItem[]

  /**
   * Tin nhắn nhúng, ghi bằng `$push` nguyên tử. KHÔNG trả ra API ở danh sách
   * và không được ghi đè bằng `save(ticket)`.
   */
  @Column('array', { nullable: true })
  messages?: TicketMessageEntry[]

  @CreateDateColumn()
  createdAt!: Date

  @UpdateDateColumn()
  updatedAt!: Date
}
