import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ObjectId,
  ObjectIdColumn,
} from 'typeorm'

export type ContractTemplateAuditAction =
  | 'draft-created'
  | 'draft-updated'
  | 'validated'
  | 'published'
  | 'legal-release-published'
  | 'protected-change-denied'

@Entity('contract_template_audits')
@Index(['templateKey', 'version', 'createdAt'])
export class ContractTemplateAudit {
  @ObjectIdColumn()
  _id!: ObjectId

  @Column()
  templateKey!: string

  @Column()
  version!: number

  @Column({ type: 'string' })
  action!: ContractTemplateAuditAction

  @Column()
  actorId!: string

  @Column({ nullable: true })
  reason?: string | null

  @Column({ nullable: true })
  beforeHash?: string | null

  @Column({ nullable: true })
  afterHash?: string | null

  @Column({ nullable: true })
  reviewReference?: string | null

  @Column({ nullable: true })
  deniedField?: string | null

  @Column({ nullable: true })
  metadata?: Record<string, string> | null

  @CreateDateColumn()
  createdAt!: Date
}
