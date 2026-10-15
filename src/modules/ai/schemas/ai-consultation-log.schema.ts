import {
  Entity,
  ObjectIdColumn,
  ObjectId,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm'

export interface MessageItem {
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: Date
}

/**
 * @deprecated G-LOG: gộp vào `ActivityLog` (collection `activity_logs`, `kind: 'ai-consultation'`).
 * Giữ lại để đọc collection cũ và migration 023. Không đăng ký forFeature, không ghi mới.
 */
@Entity('ai_consultation_logs')
export class AiConsultationLog {
  @ObjectIdColumn()
  _id!: ObjectId

  @Column()
  logId!: string

  @Column({ nullable: true })
  userId?: string | null

  @Column('json', { default: [] })
  messages!: MessageItem[]

  @Column({ default: 'pending' })
  status!:
    | 'pending'
    | 'email_sent'
    | 'in_progress'
    | 'completed'
    | 'transferred'
    | 'failed'

  @Column({ default: 'not_interested' })
  result!: 'interested' | 'not_interested' | 'registered' | 'completed'

  @Column({ nullable: true })
  recommendedPackage?: string | null

  @Column({ default: 0 })
  duration!: number

  @Column({ nullable: true })
  notes?: string | null

  @Column({ nullable: true })
  systemPrompt?: string | null

  @CreateDateColumn()
  createdAt!: Date

  @UpdateDateColumn()
  updatedAt!: Date
}
