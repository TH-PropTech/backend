import { Entity, ObjectIdColumn, ObjectId, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm'

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: Date
}

@Entity('ai_chats')
export class AiChat {
  @ObjectIdColumn()
  _id!: ObjectId

  @Column()
  userId!: string

  @Column()
  messages!: ChatMessage[]

  @CreateDateColumn()
  createdAt!: Date

  @UpdateDateColumn()
  updatedAt!: Date
}
