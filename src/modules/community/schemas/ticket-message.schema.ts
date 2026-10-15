import {
  Entity,
  ObjectIdColumn,
  ObjectId,
  Column,
  CreateDateColumn,
} from 'typeorm'

/**
 * @deprecated G-TKT: tin nhắn nay nhúng trong `SupportTicket.messages[]`.
 * Giữ lại để migration 008 đọc collection `ticket_messages` và làm kiểu trả về API.
 */
@Entity('ticket_messages')
export class TicketMessage {
  @ObjectIdColumn()
  _id!: ObjectId

  @Column()
  ticketId!: string

  @Column()
  senderId!: string

  @Column()
  senderRole!: string

  @Column()
  content!: string

  @Column('array')
  attachmentUrls!: string[]

  @Column({ default: false })
  isInternal!: boolean

  @CreateDateColumn()
  createdAt!: Date
}
