import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ObjectId,
  ObjectIdColumn,
  UpdateDateColumn,
} from 'typeorm'
import type { LegalProfile } from './legal-profile.resolver'

export type ContractTemplateStatus = 'draft' | 'published'

export type ContractTemplateClause = {
  number: number
  heading: string
  contentHash: string
  citationIds: string[]
  protected: boolean
}

export type ContractTemplateAddendum = {
  id: string
  title: string
  content: string
  enabled: boolean
}

@Entity('contract_templates')
@Index(['templateKey', 'version'], { unique: true })
@Index(['templateKey', 'status'])
export class ContractTemplate {
  @ObjectIdColumn()
  _id!: ObjectId

  @Column()
  templateKey!: string

  @Column()
  version!: number

  @Column({ type: 'string', default: 'draft' })
  status!: ContractTemplateStatus

  @Column()
  legalProfile!: LegalProfile

  @Column('json')
  clauses!: ContractTemplateClause[]

  @Column('json')
  allowedVariables!: string[]

  @Column('json')
  addenda!: ContractTemplateAddendum[]

  @Column('json')
  citationIds!: string[]

  @Column()
  contentHash!: string

  @Column({ default: 1 })
  draftRevision!: number

  @Column()
  createdBy!: string

  @Column({ nullable: true })
  updatedBy?: string | null

  @Column({ nullable: true })
  publishedBy?: string | null

  @Column({ nullable: true })
  publishedAt?: Date | null

  @CreateDateColumn()
  createdAt!: Date

  @UpdateDateColumn()
  updatedAt!: Date
}
