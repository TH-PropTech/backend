import {
  Entity,
  ObjectIdColumn,
  ObjectId,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm'

export interface PropertyCardMetadata {
  id: string
  title: string
  price: number
  image: string
  location: string
  landlordName?: string
  landlordPhone?: string
}

export interface BookingRequestMetadata {
  apartmentId: string
  apartmentTitle: string
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: Date
  metadata?: {
    propertyCard?: PropertyCardMetadata
    bookingRequest?: BookingRequestMetadata
  }
}

@Entity('ai_chats')
export class AiChat {
  @ObjectIdColumn()
  _id!: ObjectId

  @Column({ nullable: true })
  userId?: string

  @Column({ nullable: true })
  deviceId?: string

  @Column()
  messages!: ChatMessage[]

  @CreateDateColumn()
  createdAt!: Date

  @UpdateDateColumn()
  updatedAt!: Date
}
