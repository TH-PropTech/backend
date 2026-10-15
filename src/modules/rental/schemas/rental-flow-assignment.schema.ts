import {
  Entity,
  ObjectIdColumn,
  ObjectId,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm'

import type {
  FlowAssignmentScope,
  ProfileReference,
} from './rental-flow-config.schema'

export type { FlowAssignmentScope, ProfileReference }

/**
 * @deprecated Đã gom vào `RentalFlowConfig` với `kind = 'assignment'`
 * (`rental_flow_configs`, migration 024). Không còn đăng ký trong `forFeature`;
 * chỉ giữ để tương thích import kiểu và để tham chiếu dữ liệu collection cũ.
 */
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
