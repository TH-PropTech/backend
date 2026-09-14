import {
  Entity,
  ObjectIdColumn,
  ObjectId,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm'

export type FlowAssignmentScope = 'GLOBAL' | 'DURATION' | 'PACKAGE'

export interface ProfileReference {
  profileId: string
  version: number
  contentHash: string
}

@Entity('rental_flow_assignments')
export class RentalFlowAssignment {
  @ObjectIdColumn()
  _id!: ObjectId

  @Column({ unique: true })
  assignmentId!: string

  @Column({ type: 'string' })
  scope!: FlowAssignmentScope

  /** null đối với GLOBAL; '1' | '3' | '6' | '12' đối với DURATION; packageId đối với PACKAGE */
  @Column({ nullable: true })
  scopeValue!: string | null

  @Column('json')
  profileRef!: ProfileReference

  @Column()
  effectiveAt!: Date

  @Column({ nullable: true })
  supersededAt!: Date | null

  @Column({ nullable: true })
  createdBy?: string | null

  @CreateDateColumn()
  createdAt!: Date

  @UpdateDateColumn()
  updatedAt!: Date
}
