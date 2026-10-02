import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ObjectId,
  ObjectIdColumn,
} from 'typeorm'

export type ContractLayoutAuditAction =
  | 'draft-created'
  | 'draft-updated'
  | 'validated'
  | 'published'
  | 'archived'
  | 'protected-change-denied'

@Entity('contract_layout_audits')
@Index(['profileKey', 'version', 'createdAt'])
export class ContractLayoutAudit {
  @ObjectIdColumn()
  _id!: ObjectId

  @Column()
  profileKey!: string

  @Column()
  version!: number

  @Column({ type: 'string' })
  action!: ContractLayoutAuditAction

  @Column()
  actorId!: string

  @Column({ nullable: true })
  reason?: string | null

  @Column({ nullable: true })
  beforeHash?: string | null

  @Column({ nullable: true })
  afterHash?: string | null

  @Column({ nullable: true })
  deniedField?: string | null

  @CreateDateColumn()
  createdAt!: Date
}
