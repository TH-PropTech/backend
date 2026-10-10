import { Column, Entity, ObjectId, ObjectIdColumn } from 'typeorm'

/** A searchable slice of a legal doc's `content`; re-created whenever the content changes. */
@Entity('legal_knowledge_chunks')
export class LegalKnowledgeChunk {
  @ObjectIdColumn()
  _id!: ObjectId

  /** Hex string of the owning LegalKnowledgeDoc `_id`. */
  @Column()
  docId!: string

  @Column()
  order!: number

  @Column({ nullable: true })
  heading?: string | undefined

  @Column()
  text!: string
}
