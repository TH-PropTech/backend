import {
  Entity,
  ObjectIdColumn,
  ObjectId,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm'

export interface LegalTermsSection {
  id: string
  heading: string
  body: string
  order: number
}

@Entity('legal_terms_documents')
export class LegalTermsDocument {
  @ObjectIdColumn()
  _id!: ObjectId

  @Column()
  key!: string

  @Column()
  version!: number

  @Column()
  title!: string

  @Column()
  summary!: string

  @Column('json')
  sections!: LegalTermsSection[]

  @Column()
  contentHash!: string

  @Column({ type: 'string', default: 'draft' })
  status!: 'draft' | 'published'

  @Column({ default: 1 })
  draftRevision!: number

  @Column({ nullable: true })
  createdBy?: string

  @Column({ nullable: true })
  updatedBy?: string

  @Column({ nullable: true })
  publishedBy?: string

  @Column({ nullable: true })
  publishedAt?: Date

  @CreateDateColumn()
  createdAt!: Date

  @UpdateDateColumn()
  updatedAt!: Date
}
