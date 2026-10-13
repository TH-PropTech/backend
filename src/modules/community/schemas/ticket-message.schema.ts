import {
  Entity,
  ObjectIdColumn,
  ObjectId,
  Column,
  CreateDateColumn,
} from 'typeorm'

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
