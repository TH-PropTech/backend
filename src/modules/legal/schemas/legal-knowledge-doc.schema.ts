import {
  Column,
  CreateDateColumn,
  Entity,
  ObjectId,
  ObjectIdColumn,
  UpdateDateColumn,
} from 'typeorm'
import type {
  LegalDocCategory,
  LegalDocStatus,
} from '../utils/legal-knowledge.types'

/**
 * @deprecated G-LEG: dữ liệu nay nằm ở `LegalDocument{kind:'knowledge'}`
 * (collection `legal_documents`). Giữ lại làm kiểu hình và để migration 020 /
 * rollback tham chiếu collection cũ `legal_knowledge_docs`; entity này KHÔNG còn
 * nằm trong `TypeOrmModule.forFeature`.
 *
 * A legal / regulation text in the admin knowledge base. `content` is the knowledge itself.
 */
@Entity('legal_knowledge_docs')
export class LegalKnowledgeDoc {
  @ObjectIdColumn()
  _id!: ObjectId

  @Column()
  title!: string

  @Column()
  category!: LegalDocCategory

  /** Số hiệu văn bản, e.g. "27/2023/QH15". */
  @Column({ nullable: true })
  docNumber?: string | undefined

  /** Cơ quan ban hành. */
  @Column({ nullable: true })
  issuer?: string | undefined

  @Column({ nullable: true })
  sourceUrl?: string | undefined

  @Column('array', { default: [] })
  keywords!: string[]

  /** Distilled (or manually pasted) knowledge text, Markdown-like with Chương/Mục/Điều headings. */
  @Column()
  content!: string

  @Column({ nullable: true })
  summary?: string | undefined

  @Column({ type: 'string', default: 'manual' })
  contentSource!: 'link' | 'manual'

  /** When the source page was downloaded (contentSource = link). */
  @Column({ nullable: true })
  fetchedAt?: Date | undefined

  @Column({ nullable: true })
  effectiveDate?: Date | undefined

  @Column({ nullable: true })
  expiryDate?: Date | undefined

  @Column({ type: 'string', default: 'draft' })
  status!: LegalDocStatus

  @Column({ default: 0 })
  chunkCount!: number

  @Column({ nullable: true })
  createdBy?: string | undefined

  @CreateDateColumn()
  createdAt!: Date

  @UpdateDateColumn()
  updatedAt!: Date
}
