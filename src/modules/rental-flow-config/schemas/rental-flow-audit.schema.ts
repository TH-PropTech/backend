import {
  Entity,
  ObjectIdColumn,
  ObjectId,
  Column,
  CreateDateColumn,
} from 'typeorm'

export type FlowAuditAction =
  | 'DRAFT_SAVED'
  | 'PROFILE_PUBLISHED'
  | 'PROFILE_RESTORED'
  | 'ASSIGNMENT_ACTIVATED'
  | 'ASSIGNMENT_SUPERSEDED'
  | 'CONTRACT_RECONCILED'

@Entity('rental_flow_audits')
export class RentalFlowAudit {
  @ObjectIdColumn()
  _id!: ObjectId

  @Column({ type: 'string' })
  action!: FlowAuditAction

  @Column()
  actorId!: string

  @Column()
  targetType!: 'profile' | 'assignment' | 'contract'

  @Column()
  targetId!: string

  @Column({ nullable: true })
  version?: number | null

  @Column('json', { nullable: true })
  details?: Record<string, unknown> | null

  @CreateDateColumn()
  createdAt!: Date
}
